/**
 * K8s storage for user-typed secrets (generic + Anthropic).
 *
 * The Envoy credential-injector sidecar (ADR-033) reads credentials from files
 * mounted into the sidecar container. The Controller renders those mounts from
 * K8s Secrets labelled with the owner's sub. This port writes those Secrets so
 * newly-created secrets land in K8s for the sidecar to discover.
 */
import type * as k8s from "@kubernetes/client-node";
import type { EnvMapping, InjectionConfig } from "api-server-api";

import type { K8sClient } from "../../agents/infrastructure/k8s.js";

const LABEL_OWNER = "agent-platform.ai/owner";
const LABEL_SECRET_TYPE = "agent-platform.ai/secret-type";
const LABEL_MANAGED_BY = "agent-platform.ai/managed-by";
const ANN_HOST_PATTERN = "agent-platform.ai/host-pattern";
const ANN_PATH_PATTERN = "agent-platform.ai/path-pattern";
const ANN_HEADER_NAME = "agent-platform.ai/injection-header-name";
const ANN_AUTH_MODE = "agent-platform.ai/auth-mode";
const ANN_VALUE_FORMAT = "agent-platform.ai/injection-value-format";
const ANN_ENV_MAPPINGS = "agent-platform.ai/env-mappings";

export type AuthMode = "api-key" | "oauth";

/**
 * Resolves the header name + value-format template for a secret. Anthropic
 * gets a fixed shape per authMode; generic respects the user-supplied
 * `InjectionConfig` (with the `Authorization: Bearer {value}` default).
 *
 * On the wire, Envoy's generic credential source loads the file under the
 * configured header verbatim — there is no upstream prefix template (see
 * envoyproxy/envoy#37001) — so we apply the value-format substitution here
 * and store the result as the file content.
 */
export function resolveInjection(
  type: string,
  authMode: AuthMode | undefined,
  injectionConfig: InjectionConfig | undefined,
): { headerName: string; valueFormat: string } {
  if (type === "anthropic") {
    if (authMode === "api-key") {
      return { headerName: "x-api-key", valueFormat: "{value}" };
    }
    return { headerName: "Authorization", valueFormat: "Bearer {value}" };
  }
  return {
    headerName: injectionConfig?.headerName ?? "Authorization",
    valueFormat: injectionConfig?.valueFormat ?? "Bearer {value}",
  };
}

export function injectionFileContent(value: string, valueFormat: string): string {
  return valueFormat.replaceAll("{value}", value);
}

/**
 * SDS DiscoveryResponse YAML consumed by the Envoy sidecar's
 * `path_config_source` (see packages/controller/pkg/reconciler/envoy.go —
 * `envoyCredentialSDSName = "credential"` / `envoyCredentialKeySDS = "sds.yaml"`).
 *
 * Envoy's `generic` injected_credentials source reads the inline_string
 * verbatim and writes it as the value of the configured header — there is no
 * upstream prefix template (envoyproxy/envoy#37001) — so the value-format
 * substitution is baked in here.
 *
 * The string is JSON-encoded for safe embedding in YAML (JSON is valid YAML).
 */
export function sdsYamlContent(value: string, valueFormat: string): string {
  const inline = injectionFileContent(value, valueFormat);
  return [
    "resources:",
    '- "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret',
    "  name: credential",
    "  generic_secret:",
    "    secret:",
    `      inline_string: ${JSON.stringify(inline)}`,
    "",
  ].join("\n");
}

export interface K8sStoredSecret {
  id: string;
  name: string;
  type: string;
  hostPattern: string;
  pathPattern?: string | null;
  injectionConfig?: InjectionConfig | null;
  createdAt: string;
  authMode?: AuthMode;
  envMappings?: EnvMapping[];
}

export interface K8sSecretsPort {
  listSecrets(): Promise<K8sStoredSecret[]>;
  createSecret(input: {
    id: string;
    name: string;
    type: string;
    value: string;
    hostPattern: string;
    pathPattern?: string;
    injectionConfig?: InjectionConfig;
    authMode?: AuthMode;
    envMappings?: EnvMapping[];
  }): Promise<void>;
  updateSecret(
    id: string,
    input: {
      name?: string;
      value?: string;
      hostPattern?: string;
      pathPattern?: string | null;
      injectionConfig?: InjectionConfig | null;
      authMode?: AuthMode;
      envMappings?: EnvMapping[];
    },
  ): Promise<void>;
  deleteSecret(id: string): Promise<void>;
}

// K8s metadata.name is RFC 1123 subdomain: lowercase alphanumeric / hyphen,
// must start and end with alphanumeric. The previous version used
// `id.toLowerCase()` defensively, but that masks IDs that aren't already
// valid (e.g. mixed case → silent collisions on case-only differences) and
// can still produce invalid names if the ID contains other characters.
// Validate up-front instead — callers hand us UUIDs, so this is a no-op
// for the happy path and a hard error for anything else.
const K8S_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const K8S_NAME_PREFIX = "platform-cred-";
const K8S_NAME_MAX_ID_LEN = 253 - K8S_NAME_PREFIX.length;

function k8sSecretName(id: string): string {
  if (id.length === 0 || id.length > K8S_NAME_MAX_ID_LEN || !K8S_NAME_RE.test(id)) {
    throw new Error(
      `secret id ${JSON.stringify(id)} is not a valid K8s name component`,
    );
  }
  return `${K8S_NAME_PREFIX}${id}`;
}

export function createK8sSecretsPort(client: K8sClient, ownerSub: string): K8sSecretsPort {
  return {
    async listSecrets() {
      const list = await client.listSecrets(
        `${LABEL_OWNER}=${ownerSub},${LABEL_MANAGED_BY}=api-server`,
      );
      return list
        .filter((s) => s.metadata?.name?.startsWith(K8S_NAME_PREFIX))
        .map((s) => {
          const ann = s.metadata?.annotations ?? {};
          const labels = s.metadata?.labels ?? {};
          const id = s.metadata!.name!.slice(K8S_NAME_PREFIX.length);
          const headerName = ann[ANN_HEADER_NAME];
          const valueFormat = ann[ANN_VALUE_FORMAT];
          const injectionConfig: InjectionConfig | undefined =
            headerName && valueFormat ? { headerName, valueFormat } : undefined;
          const authMode = ann[ANN_AUTH_MODE] as AuthMode | undefined;
          const stored: K8sStoredSecret = {
            id,
            name: ann["agent-platform.ai/display-name"] ?? id,
            type: labels[LABEL_SECRET_TYPE] ?? "generic",
            hostPattern: ann[ANN_HOST_PATTERN] ?? "",
            createdAt: s.metadata?.creationTimestamp
              ? new Date(s.metadata.creationTimestamp).toISOString()
              : new Date().toISOString(),
          };
          if (ann[ANN_PATH_PATTERN]) stored.pathPattern = ann[ANN_PATH_PATTERN];
          if (injectionConfig) stored.injectionConfig = injectionConfig;
          if (authMode) stored.authMode = authMode;
          if (ann[ANN_ENV_MAPPINGS]) {
            try { stored.envMappings = JSON.parse(ann[ANN_ENV_MAPPINGS]); } catch { /* ignore malformed */ }
          }
          return stored;
        });
    },

    async createSecret({ id, name, type, value, hostPattern, pathPattern, injectionConfig, authMode, envMappings }) {
      const secretType = type === "anthropic" ? "anthropic" : "generic";
      const { headerName, valueFormat } = resolveInjection(secretType, authMode, injectionConfig);
      const annotations: Record<string, string> = {
        [ANN_HOST_PATTERN]: hostPattern,
        [ANN_HEADER_NAME]: headerName,
        [ANN_VALUE_FORMAT]: valueFormat,
        "agent-platform.ai/display-name": name,
      };
      if (pathPattern) annotations[ANN_PATH_PATTERN] = pathPattern;
      if (authMode) annotations[ANN_AUTH_MODE] = authMode;
      if (envMappings?.length) annotations[ANN_ENV_MAPPINGS] = JSON.stringify(envMappings);

      const body: k8s.V1Secret = {
        metadata: {
          name: k8sSecretName(id),
          labels: {
            [LABEL_OWNER]: ownerSub,
            [LABEL_SECRET_TYPE]: secretType,
            [LABEL_MANAGED_BY]: "api-server",
          },
          annotations,
        },
        type: "Opaque",
        stringData: { "sds.yaml": sdsYamlContent(value, valueFormat) },
      };
      await client.createSecret(body);
    },

    async updateSecret(id, patch) {
      const existing = await client.getSecret(k8sSecretName(id));
      if (!existing) return;

      const annotations = { ...(existing.metadata?.annotations ?? {}) };
      const labels = existing.metadata?.labels ?? {};
      const secretType = labels[LABEL_SECRET_TYPE] ?? "generic";

      if (patch.name !== undefined) annotations["agent-platform.ai/display-name"] = patch.name;
      if (patch.hostPattern !== undefined) annotations[ANN_HOST_PATTERN] = patch.hostPattern;
      if (patch.pathPattern === null) delete annotations[ANN_PATH_PATTERN];
      else if (patch.pathPattern !== undefined) annotations[ANN_PATH_PATTERN] = patch.pathPattern;
      if (patch.envMappings !== undefined) {
        if (patch.envMappings.length > 0) annotations[ANN_ENV_MAPPINGS] = JSON.stringify(patch.envMappings);
        else delete annotations[ANN_ENV_MAPPINGS];
      }

      // Recompute header + value format if the injection config or auth mode
      // changed; otherwise keep what was stored at create time. The router
      // enforces that any `injectionConfig` change is paired with a new
      // `value`, so we re-bake the SDS file in that branch below — there is
      // no need to recover the prior value from the existing inline_string.
      const newAuthMode: AuthMode | undefined = patch.authMode ?? (annotations[ANN_AUTH_MODE] as AuthMode | undefined);
      const newInjection: InjectionConfig | undefined =
        patch.injectionConfig === null ? undefined :
        patch.injectionConfig ?? (annotations[ANN_HEADER_NAME] && annotations[ANN_VALUE_FORMAT]
          ? { headerName: annotations[ANN_HEADER_NAME]!, valueFormat: annotations[ANN_VALUE_FORMAT]! }
          : undefined);

      const { headerName, valueFormat } = resolveInjection(secretType, newAuthMode, newInjection);
      annotations[ANN_HEADER_NAME] = headerName;
      annotations[ANN_VALUE_FORMAT] = valueFormat;
      if (newAuthMode) annotations[ANN_AUTH_MODE] = newAuthMode;

      const body: k8s.V1Secret = {
        ...existing,
        metadata: { ...existing.metadata, annotations },
      };
      if (patch.value !== undefined) {
        body.stringData = { ...(body.stringData ?? {}), "sds.yaml": sdsYamlContent(patch.value, valueFormat) };
        body.data = undefined;
      }
      await client.replaceSecret(k8sSecretName(id), body);
    },

    async deleteSecret(id) {
      await client.deleteSecret(k8sSecretName(id));
    },
  };
}
