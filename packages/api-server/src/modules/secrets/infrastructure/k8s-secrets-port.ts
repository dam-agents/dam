/**
 * K8s storage for user-typed secrets (generic + Anthropic).
 *
 * The Envoy credential-injector sidecar (ADR-033) reads credentials from files
 * mounted into the sidecar container. The Controller renders those mounts from
 * K8s Secrets labelled with the owner's sub. This port writes those Secrets so
 * newly-created secrets land in K8s for the sidecar to discover.
 */
import type * as k8s from "@kubernetes/client-node";
import { isProviderPresetType, PROVIDERS, type EnvMapping, type InjectionConfig, type SecretType } from "api-server-api";

import type { K8sClient } from "../../agents/infrastructure/k8s.js";

const LABEL_OWNER = "agent-platform.ai/owner";
const LABEL_SECRET_TYPE = "agent-platform.ai/secret-type";
const LABEL_MANAGED_BY = "agent-platform.ai/managed-by";
const ANN_HOST_PATTERN = "agent-platform.ai/host-pattern";
const ANN_PATH_PATTERN = "agent-platform.ai/path-pattern";
const ANN_HEADER_NAME = "agent-platform.ai/injection-header-name";
const ANN_AUTH_MODE = "agent-platform.ai/auth-mode";
const ANN_VALUE_FORMAT = "agent-platform.ai/injection-value-format";
const ANN_QUERY_PARAM = "agent-platform.ai/injection-query-param";
const ANN_ENV_MAPPINGS = "agent-platform.ai/env-mappings";
// Twin → primary link. Set on extraInjections-derived secrets.
const ANN_PRIMARY_ID = "agent-platform.ai/primary-secret-id";

export type AuthMode = "api-key" | "oauth";

/**
 * Resolves the header name + value-format template for a secret. Provider
 * presets read their injection config from the {@link PROVIDERS} registry
 * (per mode); generic respects the user-supplied `InjectionConfig` and
 * falls back to `Authorization: Bearer {value}`.
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
  if (isProviderPresetType(type as SecretType)) {
    const preset = PROVIDERS[type as Exclude<SecretType, "generic">];
    const mode = authMode
      ? preset.modes.find((m) => m.key === authMode)
      : preset.modes[0];
    if (mode?.injection) {
      return {
        headerName: mode.injection.headerName,
        valueFormat: mode.injection.valueFormat ?? "{value}",
      };
    }
    // Fall through to default Bearer for presets without an explicit override.
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
 * Build the SDS DiscoveryResponse YAML for a credential. The `inline_string`
 * Envoy reads is provided as-is — see {@link sdsInlineString} for what each
 * injection mode bakes in.
 *
 * Path: packages/controller/pkg/reconciler/envoy.go reads this file as the
 * `generic` injected_credentials source.
 */
export function sdsYamlContent(inlineString: string): string {
  return [
    "resources:",
    '- "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret',
    "  name: credential",
    "  generic_secret:",
    "    secret:",
    `      inline_string: ${JSON.stringify(inlineString)}`,
    "",
  ].join("\n");
}

/**
 * Compose the SDS inline_string for a secret. Two modes:
 *
 *   - Header-only injection (no `queryParamName`): bake `valueFormat` here
 *     and store the formatted result (e.g. `Bearer sk-…`). Envoy's generic
 *     credential source has no upstream prefix template (envoyproxy/envoy#37001),
 *     so the value-format substitution has to happen before it lands in
 *     the file.
 *
 *   - Query-param injection (`queryParamName` set): store the bare raw
 *     value. The controller's per-route Lua filter moves the value into
 *     the URL query parameter (and strips the header), so a `Bearer `
 *     prefix would leak into the URL as `?key=Bearer%20…` and the upstream
 *     would reject it. To inject the same credential into both a header
 *     AND a URL parameter on the same endpoint, create two Secrets with
 *     the same host pattern — one header-only, one with queryParamName.
 */
export function sdsInlineString(
  value: string,
  valueFormat: string,
  queryParamName: string | undefined,
): string {
  return queryParamName ? value : injectionFileContent(value, valueFormat);
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
  primarySecretId?: string;
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
    primarySecretId?: string;
  }): Promise<void>;
  /**
   * Apply the patch and return the before/after view so the service layer
   * can diff render-affecting fields without a redundant read. Returns
   * `null` when the secret doesn't exist (e.g. concurrent delete).
   */
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
  ): Promise<{ before: K8sStoredSecret; after: K8sStoredSecret } | null>;
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

/** Parse a V1Secret into the domain shape. Used by both `listSecrets` and the
 *  before/after read in `updateSecret`. */
function parseStoredSecret(s: k8s.V1Secret): K8sStoredSecret | null {
  if (!s.metadata?.name?.startsWith(K8S_NAME_PREFIX)) return null;
  const ann = s.metadata.annotations ?? {};
  const labels = s.metadata.labels ?? {};
  const id = s.metadata.name.slice(K8S_NAME_PREFIX.length);
  const headerName = ann[ANN_HEADER_NAME];
  const valueFormat = ann[ANN_VALUE_FORMAT];
  const queryParamName = ann[ANN_QUERY_PARAM] || undefined;
  // Query-only secrets may legitimately have no ANN_VALUE_FORMAT — the
  // Lua filter doesn't apply it and the api-server doesn't stamp the
  // default. Header-only / dual secrets still require valueFormat for
  // injectionConfig to be returned.
  let injectionConfig: InjectionConfig | undefined;
  if (headerName) {
    if (valueFormat) {
      injectionConfig = queryParamName
        ? { headerName, valueFormat, queryParamName }
        : { headerName, valueFormat };
    } else if (queryParamName) {
      injectionConfig = { headerName, queryParamName };
    }
  }
  const authMode = ann[ANN_AUTH_MODE] as AuthMode | undefined;
  const stored: K8sStoredSecret = {
    id,
    name: ann["agent-platform.ai/display-name"] ?? id,
    type: labels[LABEL_SECRET_TYPE] ?? "generic",
    hostPattern: ann[ANN_HOST_PATTERN] ?? "",
    createdAt: s.metadata.creationTimestamp
      ? new Date(s.metadata.creationTimestamp).toISOString()
      : new Date().toISOString(),
  };
  if (ann[ANN_PATH_PATTERN]) stored.pathPattern = ann[ANN_PATH_PATTERN];
  if (injectionConfig) stored.injectionConfig = injectionConfig;
  if (authMode) stored.authMode = authMode;
  if (ann[ANN_ENV_MAPPINGS]) {
    try {
      stored.envMappings = JSON.parse(ann[ANN_ENV_MAPPINGS]);
    } catch {
      /* malformed annotation — controller falls back to legacy switch */
    }
  }
  if (ann[ANN_PRIMARY_ID]) stored.primarySecretId = ann[ANN_PRIMARY_ID];
  return stored;
}

export function createK8sSecretsPort(client: K8sClient, ownerSub: string): K8sSecretsPort {
  return {
    async listSecrets() {
      const list = await client.listSecrets(
        `${LABEL_OWNER}=${ownerSub},${LABEL_MANAGED_BY}=api-server`,
      );
      return list
        .map(parseStoredSecret)
        .filter((s): s is K8sStoredSecret => s !== null);
    },

    async createSecret({ id, name, type, value, hostPattern, pathPattern, injectionConfig, authMode, envMappings, primarySecretId }) {
      const secretType = isProviderPresetType(type as SecretType) ? type : "generic";
      const { headerName, valueFormat } = resolveInjection(secretType, authMode, injectionConfig);
      const annotations: Record<string, string> = {
        [ANN_HOST_PATTERN]: hostPattern,
        [ANN_HEADER_NAME]: headerName,
        "agent-platform.ai/display-name": name,
      };
      // Skip ANN_VALUE_FORMAT for query-only secrets where the user didn't
      // explicitly supply a valueFormat — the Lua filter ignores it (SDS
      // holds the bare value), and stamping the default `Bearer {value}`
      // would mislead anyone reading the raw Secret. Always stamp it for
      // header-only secrets, since the SDS file content is baked from it.
      if (injectionConfig?.valueFormat !== undefined || !injectionConfig?.queryParamName) {
        annotations[ANN_VALUE_FORMAT] = valueFormat;
      }
      if (pathPattern) annotations[ANN_PATH_PATTERN] = pathPattern;
      if (authMode) annotations[ANN_AUTH_MODE] = authMode;
      if (envMappings?.length) annotations[ANN_ENV_MAPPINGS] = JSON.stringify(envMappings);
      if (injectionConfig?.queryParamName) {
        annotations[ANN_QUERY_PARAM] = injectionConfig.queryParamName;
      }
      if (primarySecretId) annotations[ANN_PRIMARY_ID] = primarySecretId;

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
        stringData: {
          "sds.yaml": sdsYamlContent(
            sdsInlineString(value, valueFormat, injectionConfig?.queryParamName),
          ),
        },
      };
      await client.createSecret(body);
    },

    async updateSecret(id, patch) {
      const existing = await client.getSecret(k8sSecretName(id));
      if (!existing) return null;
      const before = parseStoredSecret(existing);
      if (!before) return null;

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
      // Recover the existing InjectionConfig from annotations to seed
      // resolveInjection when the caller didn't supply a fresh one.
      // Query-only secrets may have no ANN_VALUE_FORMAT (we skip
      // stamping the default for them); accept that shape.
      let existingInjection: InjectionConfig | undefined;
      if (annotations[ANN_HEADER_NAME]) {
        const h = annotations[ANN_HEADER_NAME]!;
        const v = annotations[ANN_VALUE_FORMAT];
        const q = annotations[ANN_QUERY_PARAM];
        if (v) {
          existingInjection = q ? { headerName: h, valueFormat: v, queryParamName: q } : { headerName: h, valueFormat: v };
        } else if (q) {
          existingInjection = { headerName: h, queryParamName: q };
        }
      }
      const newInjection: InjectionConfig | undefined =
        patch.injectionConfig === null ? undefined :
        patch.injectionConfig ?? existingInjection;

      const { headerName, valueFormat } = resolveInjection(secretType, newAuthMode, newInjection);
      annotations[ANN_HEADER_NAME] = headerName;
      // Mirror createSecret: skip stamping ANN_VALUE_FORMAT for query-only
      // secrets where the user didn't explicitly supply a valueFormat.
      if (newInjection?.valueFormat !== undefined || !newInjection?.queryParamName) {
        annotations[ANN_VALUE_FORMAT] = valueFormat;
      } else {
        delete annotations[ANN_VALUE_FORMAT];
      }
      if (newAuthMode) annotations[ANN_AUTH_MODE] = newAuthMode;
      if (newInjection?.queryParamName) annotations[ANN_QUERY_PARAM] = newInjection.queryParamName;
      else delete annotations[ANN_QUERY_PARAM];

      const body: k8s.V1Secret = {
        ...existing,
        metadata: { ...existing.metadata, annotations },
      };
      if (patch.value !== undefined) {
        body.stringData = {
          ...(body.stringData ?? {}),
          "sds.yaml": sdsYamlContent(
            sdsInlineString(patch.value, valueFormat, newInjection?.queryParamName),
          ),
        };
        body.data = undefined;
      }
      const replaced = await client.replaceSecret(k8sSecretName(id), body);
      const after = parseStoredSecret(replaced) ?? before;
      return { before, after };
    },

    async deleteSecret(id) {
      await client.deleteSecret(k8sSecretName(id));
    },
  };
}
