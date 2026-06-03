import type * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import { z } from "zod";
import { agentSpecSchema } from "api-server-api";
import type {
  Agent,
  AgentState,
  ChannelConfig,
  DriverFailure,
} from "api-server-api";
import {
  ANN_GRANTED_CONNECTION_IDS,
  ANN_GRANTED_SECRET_IDS,
  ANN_CREATE_ERROR,
  ANN_CONVERGED_POD,
  ANN_PENDING_IMPORT,
  ANN_IMPORT_ERROR,
  LABEL_TYPE,
  LABEL_OWNER,
  LABEL_TEMPLATE_REF,
  LAST_ACTIVITY_KEY,
  TYPE_AGENT,
  SPEC_KEY,
  STATUS_KEY,
} from "./labels.js";
import {
  displayName,
  generateK8sName,
  isPodReady,
} from "./configmap-mappers.js";

const agentStatusSchema = z.object({
  currentState: z.enum(["running", "hibernated", "error"]).optional(),
  error: z.string().optional(),
});

/** Long backstop for the only unobservable case — an api-server crash mid-import. ≥ the agent's 30-min import wall-clock + margin; normal failures are marked explicitly, not via TTL. */
const PENDING_IMPORT_TTL_MS = 35 * 60_000;

/** Outbox-derived contribution fact: has the current version settled, and what failed. */
export interface ContributionsStatus {
  settled: boolean;
  failures: DriverFailure[];
}

/** The raw observed lifecycle from the agent's status.yaml. */
export interface InfraAgent {
  id: string;
  name: string;
  templateId?: string;
  spec: z.infer<typeof agentSpecSchema>;
  desiredState: "running" | "hibernated";
  currentState?: "running" | "hibernated" | "error";
  error?: string;
  podReady: boolean;
  /** The live pod is terminating (deletionTimestamp set) — gates "running" even while still Ready. */
  terminating: boolean;
  /** Live pod uid (the converged-since-boot marker is keyed to it); absent when no pod. */
  podUid?: string;
  /** The live pod has converged at least once since it booted — later applies/imports no longer gate "running". */
  warm: boolean;
  contributionsSettled: boolean;
  applyFailures: DriverFailure[];
  /** A file import is expected and hasn't landed yet (gates "running"). */
  importPending: boolean;
  /** Reason the latest import failed (badge); absent when clean or in progress. */
  importError?: string;
  /** Set when the create flow failed after the CM was made; forces the error state. */
  createError?: string;
}

/** Synthesise the public-facing state from observed + desired. */
export function computeAgentState(infra: InfraAgent): AgentState {
  if (infra.createError) return "error";
  if (infra.currentState === "error") return "error";
  if (infra.desiredState === "running" && infra.currentState !== "running")
    return "starting";
  if (infra.desiredState === "hibernated" && infra.currentState === "running")
    return "hibernating";
  if (infra.desiredState === "hibernated") return "hibernated";
  // A terminating pod (roll/restart/evict/drain) is on its way out even while still Ready.
  if (infra.terminating) return "starting";
  if (!infra.podReady) return "starting";
  // Contributions + import gate "running" only during a startup opening (create or wake);
  // once the pod is warm, later incremental applies/imports apply silently.
  if (!infra.warm) {
    if (!infra.contributionsSettled) return "starting";
    if (infra.importPending) return "starting";
  }
  return "running";
}

/** Default when no outbox row exists, or a status read fails (fail-soft): nothing to apply ⇒ settled. */
export const SETTLED_DEFAULT: ContributionsStatus = {
  settled: true,
  failures: [],
};

export function parseInfraAgent(
  cm: k8s.V1ConfigMap,
  pod?: k8s.V1Pod,
  contributions: ContributionsStatus = SETTLED_DEFAULT,
): InfraAgent {
  const spec = agentSpecSchema.parse(yaml.load(cm.data?.[SPEC_KEY] ?? ""));
  const statusYaml = cm.data?.[STATUS_KEY];
  let currentState: InfraAgent["currentState"];
  let error: string | undefined;
  if (statusYaml) {
    const raw = agentStatusSchema.parse(yaml.load(statusYaml));
    currentState = raw.currentState;
    error = raw.error || undefined;
  }
  const annotations = cm.metadata?.annotations ?? {};
  const pendingImportMarker = annotations[ANN_PENDING_IMPORT];
  const explicitImportError = annotations[ANN_IMPORT_ERROR] || undefined;
  const podUid = pod?.metadata?.uid;
  return {
    id: cm.metadata!.name!,
    name: spec.name ?? displayName(cm),
    templateId: cm.metadata?.labels?.[LABEL_TEMPLATE_REF],
    spec,
    desiredState: spec.desiredState ?? "running",
    currentState,
    error,
    podReady: pod ? isPodReady(pod) : false,
    terminating: pod?.metadata?.deletionTimestamp != null,
    podUid,
    warm: podUid != null && annotations[ANN_CONVERGED_POD] === podUid,
    contributionsSettled: contributions.settled,
    applyFailures: contributions.failures,
    // An explicit import-error overrides "in progress" so a failed import leaves "starting" even if the timestamp wasn't cleared.
    importPending: isFreshImport(pendingImportMarker) && !explicitImportError,
    importError:
      explicitImportError ??
      (isStaleImport(pendingImportMarker)
        ? "import did not complete"
        : undefined),
    createError: annotations[ANN_CREATE_ERROR] || undefined,
  };
}

/** A fresh (not yet TTL-expired) in-progress import timestamp. */
function isFreshImport(marker: string | undefined): boolean {
  if (!marker) return false;
  const stampedAt = Date.parse(marker);
  return (
    Number.isFinite(stampedAt) && Date.now() - stampedAt < PENDING_IMPORT_TTL_MS
  );
}

/** A stale in-progress timestamp — the import was abandoned (api-server crash mid-import). */
function isStaleImport(marker: string | undefined): boolean {
  if (!marker) return false;
  const stampedAt = Date.parse(marker);
  return (
    Number.isFinite(stampedAt) &&
    Date.now() - stampedAt >= PENDING_IMPORT_TTL_MS
  );
}

export function assembleAgent(
  infra: InfraAgent,
  channels: ChannelConfig[],
  allowedUserEmails: string[],
): Agent {
  return {
    id: infra.id,
    name: infra.name,
    templateId: infra.templateId,
    spec: infra.spec,
    state: computeAgentState(infra),
    error:
      infra.createError ??
      (infra.currentState === "error" ? infra.error : undefined),
    contributionFailures: infra.applyFailures,
    importError: infra.importError,
    channels,
    allowedUserEmails,
  };
}

export function buildAgentConfigMap(
  spec: Record<string, unknown>,
  owner: string,
  templateId?: string,
  pendingImport?: boolean,
): k8s.V1ConfigMap {
  const labels: Record<string, string> = {
    [LABEL_TYPE]: TYPE_AGENT,
    [LABEL_OWNER]: owner,
  };
  if (templateId) labels[LABEL_TEMPLATE_REF] = templateId;

  return {
    metadata: {
      name: generateK8sName("agent"),
      labels,
      annotations: {
        [LAST_ACTIVITY_KEY]: new Date().toISOString(),
        [ANN_GRANTED_SECRET_IDS]: "",
        [ANN_GRANTED_CONNECTION_IDS]: "",
        ...(pendingImport
          ? { [ANN_PENDING_IMPORT]: new Date().toISOString() }
          : {}),
      },
    },
    data: { [SPEC_KEY]: yaml.dump(spec) },
  };
}

export function findOrphanedAgentIds(
  infraIds: Set<string>,
  psqlAgentIds: string[],
): string[] {
  return psqlAgentIds.filter((id) => !infraIds.has(id));
}
