/**
 * Self-contained reader for legacy provider/PAT K8s Secrets, used only by the
 * secrets→connections boot migration. It deliberately imports nothing from
 * `modules/secrets` (slice 04 deletes that module); the parse logic mirrors
 * `secrets/infrastructure/k8s-secrets-port.ts` `parseStoredSecret`, copied here
 * so the migration stays independent. Both this file and the migration are
 * removed by the #1273 controller-cleanup follow-up once a clean drain is
 * field-confirmed.
 *
 * Unlike the secrets port, this reader lists across *all* owners (the
 * api-server's own cross-owner K8s reach) and recovers the owner from the
 * Secret label rather than scoping to one caller.
 */
import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import type { EnvMapping } from "api-server-api";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";

const LABEL_OWNER = "agent-platform.ai/owner";
const LABEL_MANAGED_BY = "agent-platform.ai/managed-by";
const LABEL_SECRET_TYPE = "agent-platform.ai/secret-type";
const ANN_HOST_PATTERN = "agent-platform.ai/host-pattern";
const ANN_PATH_PATTERN = "agent-platform.ai/path-pattern";
const ANN_HEADER_NAME = "agent-platform.ai/injection-header-name";
const ANN_AUTH_MODE = "agent-platform.ai/auth-mode";
const ANN_VALUE_FORMAT = "agent-platform.ai/injection-value-format";
const ANN_QUERY_PARAM = "agent-platform.ai/injection-query-param";
const ANN_ENV_MAPPINGS = "agent-platform.ai/env-mappings";
const ANN_DISPLAY_NAME = "agent-platform.ai/display-name";
const ANN_PRIMARY_ID = "agent-platform.ai/primary-secret-id";

// Legacy secrets carry this name prefix; connection secrets use
// `platform-secret-`. Filtering on it keeps the reader scoped to the
// soon-deleted population.
const LEGACY_NAME_PREFIX = "platform-cred-";

export type AuthMode = "api-key" | "oauth";

/** One parsed legacy K8s Secret. `inlineString` is the baked SDS value Envoy
 *  reads — formatted (`Bearer sk-…`) for header injections, bare for
 *  query-param injections. */
export interface LegacySecret {
  owner: string;
  id: string;
  /** `secret-type` label: a provider preset id (anthropic/openai/…) or `generic`. */
  type: string;
  displayName: string;
  hostPattern: string;
  pathPattern?: string;
  headerName?: string;
  valueFormat?: string;
  queryParamName?: string;
  authMode?: AuthMode;
  envMappings: EnvMapping[];
  /** Set on provider-preset twins (e.g. Bob's query-param half) → their primary. */
  primarySecretId?: string;
  inlineString: string;
}

function readEnvMappings(raw: string | undefined): EnvMapping[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EnvMapping[]) : [];
  } catch {
    return [];
  }
}

/** Pull `resources[0].generic_secret.secret.inline_string` out of the stored
 *  SDS YAML. Returns null when the secret has no parseable sds.yaml. */
function readInlineString(secret: k8s.V1Secret): string | null {
  const encoded = secret.data?.["sds.yaml"];
  if (!encoded) return null;
  let doc: unknown;
  try {
    doc = yaml.load(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
  const resources = (doc as { resources?: unknown })?.resources;
  const first = Array.isArray(resources) ? resources[0] : undefined;
  const inline = (
    first as { generic_secret?: { secret?: { inline_string?: unknown } } }
  )?.generic_secret?.secret?.inline_string;
  return typeof inline === "string" ? inline : null;
}

function parseLegacySecret(s: k8s.V1Secret): LegacySecret | null {
  const name = s.metadata?.name;
  if (!name?.startsWith(LEGACY_NAME_PREFIX)) return null;
  const labels = s.metadata?.labels ?? {};
  const type = labels[LABEL_SECRET_TYPE] ?? "generic";
  // Connection secrets share the owner/managed-by labels; exclude them.
  if (type === "connection") return null;
  const owner = labels[LABEL_OWNER];
  if (!owner) return null;
  const inlineString = readInlineString(s);
  if (inlineString === null) return null;

  const ann = s.metadata?.annotations ?? {};
  const out: LegacySecret = {
    owner,
    id: name.slice(LEGACY_NAME_PREFIX.length),
    type,
    displayName: ann[ANN_DISPLAY_NAME] ?? name.slice(LEGACY_NAME_PREFIX.length),
    hostPattern: ann[ANN_HOST_PATTERN] ?? "",
    envMappings: readEnvMappings(ann[ANN_ENV_MAPPINGS]),
    inlineString,
  };
  if (ann[ANN_PATH_PATTERN]) out.pathPattern = ann[ANN_PATH_PATTERN];
  if (ann[ANN_HEADER_NAME]) out.headerName = ann[ANN_HEADER_NAME];
  if (ann[ANN_VALUE_FORMAT]) out.valueFormat = ann[ANN_VALUE_FORMAT];
  if (ann[ANN_QUERY_PARAM]) out.queryParamName = ann[ANN_QUERY_PARAM];
  const authMode = ann[ANN_AUTH_MODE];
  if (authMode === "api-key" || authMode === "oauth") out.authMode = authMode;
  if (ann[ANN_PRIMARY_ID]) out.primarySecretId = ann[ANN_PRIMARY_ID];
  return out;
}

/** List legacy provider/PAT Secrets — across all owners, or scoped to one when
 *  `owner` is given (the per-agent env source reads only its agent's owner). */
export async function listLegacySecrets(
  client: K8sClient,
  owner?: string,
): Promise<LegacySecret[]> {
  const selector = owner
    ? `${LABEL_OWNER}=${owner},${LABEL_MANAGED_BY}=api-server`
    : `${LABEL_MANAGED_BY}=api-server`;
  const raw = await client.listSecrets(selector);
  return raw
    .map(parseLegacySecret)
    .filter((s): s is LegacySecret => s !== null);
}
