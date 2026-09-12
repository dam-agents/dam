import { agentKindSchema } from "api-server-api";
import { type RuntimeFeatures } from "agent-runtime-api";
import type {
  Agent,
  AgentKind,
  AgentSpec,
  AgentSpecCR,
  AgentState,
  ChannelConfig,
  ContributionKind,
  DriverFailure,
  TemplateUpdate,
} from "api-server-api";
import type { AgentRecord } from "./agent-store.js";
import {
  ANN_AGENT_KIND,
  ANN_KB_TEMPLATE,
  ANN_LIFETIME_MS,
  ANN_SWEEPABLE,
  LAST_ACTIVITY_KEY,
  STOP_REQUESTED_KEY,
} from "./labels.js";
import { resolveEffectiveHibernationTimeoutMin } from "../domain/spec-assembly.js";

export interface InfraAgent {
  id: string;
  name: string;
  templateId?: string;
  owner?: string;
  spec: AgentSpec;
  sweepable: boolean;
  lifetimeMs: number;
  kind?: AgentKind;
  kbTemplateId?: string;
  hibernatedSince?: Date;
  ready: boolean;
  hibernated: boolean;
  assignedNode: string | null;
  supervised: boolean;
  stopRequested: boolean;
  overBudget: boolean;
  overBudgetMessage?: string;
  error?: string;
  errorReason?: string;
  sandboxTerminationReason?: string;
  usageMemoryBytes?: number;
  usageCpuMilli?: number;
  noCapacityMessage?: string;
  sandboxRestarts: number;
  sandboxRestartReason?: string;
  sandboxNotReadyReason?: string;
  sandboxReady?: boolean;
  gatewayReady?: boolean;
  gatewayNotReadyReason?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The single state a caller sees, folded from what
 * a node observed and where the agent is placed.
 *
 * Readiness is something a node published while it was running the agent, and
 * it stays published. An agent assigned to no node is being run by nobody, so
 * that readiness is the last thing that was true rather than what is — and
 * calling it running sends a caller to dial an address that answers to no one.
 * An agent no node has room for is its own answer rather than a kind of
 * starting. "The install is full" and "you are using your share" ask a person
 * to do different things — wait, or stop one of their own — and an agent that
 * reports neither, for as long as anyone watches it, asks them to do nothing
 * and expect something.
 *
 * "Supervised" is that question answered by whoever knows: assigned to a node,
 * and that node still answering. A caller that is told an agent is running
 * dials it, so the two ways of not being run — between nodes, and on a node
 * that has gone quiet — have to read the same.
 */
export function computeAgentState(
  infra: InfraAgent,
  preparingWorkspace = false,
): AgentState {
  if (infra.error) return "error";
  if (infra.noCapacityMessage && !infra.supervised) return "no_capacity";
  if (infra.ready && !infra.supervised) return "starting";
  if (infra.ready)
    return preparingWorkspace ? "preparing_workspace" : "running";
  if (infra.hibernated) return "hibernated";
  if (infra.overBudget) return "over_budget";
  if (infra.sandboxReady === true && infra.gatewayReady === false)
    return preparingWorkspace ? "preparing_workspace" : "running";
  return "starting";
}

export function agentIsOwnedBy(record: AgentRecord, owner: string): boolean {
  return record.owner === owner;
}

export function parseInfraAgent(
  record: AgentRecord,
  liveNodes?: ReadonlySet<string>,
): InfraAgent {
  const crSpec = record.spec ?? ({} as AgentSpecCR);
  const spec: AgentSpec = { ...crSpec, name: crSpec.name ?? record.id };

  const status = record.status ?? {};
  const annotations = record.annotations ?? {};
  const lifetimeMs = Number.parseInt(annotations[ANN_LIFETIME_MS] ?? "", 10);
  const kindParse = agentKindSchema.safeParse(annotations[ANN_AGENT_KIND]);
  const restarts = status.sandboxRestarts;

  return {
    id: record.id,
    name: spec.name,
    assignedNode: record.assignedNode ?? null,
    supervised:
      record.assignedNode !== null &&
      record.assignedNode !== undefined &&
      (liveNodes?.has(record.assignedNode) ?? true),
    ...(record.templateId ? { templateId: record.templateId } : {}),
    owner: record.owner,
    spec,
    sweepable: annotations[ANN_SWEEPABLE] === "true",
    lifetimeMs: Number.isFinite(lifetimeMs) && lifetimeMs > 0 ? lifetimeMs : 0,
    ...(kindParse.success ? { kind: kindParse.data } : {}),
    ...(annotations[ANN_KB_TEMPLATE]
      ? { kbTemplateId: annotations[ANN_KB_TEMPLATE] }
      : {}),
    ...(status.hibernated && status.hibernatedSince
      ? { hibernatedSince: new Date(status.hibernatedSince) }
      : {}),
    ready: status.ready === true,
    hibernated: status.hibernated === true,
    stopRequested: !!annotations[STOP_REQUESTED_KEY],
    overBudget: status.overBudget === true,
    overBudgetMessage: status.overBudgetMessage || undefined,
    error: status.error || undefined,
    errorReason: status.errorReason || undefined,
    sandboxTerminationReason: status.sandboxTerminationReason || undefined,
    noCapacityMessage: status.noCapacityMessage || undefined,
    ...(status.usageMemoryBytes !== undefined
      ? { usageMemoryBytes: status.usageMemoryBytes }
      : {}),
    ...(status.usageCpuMilli !== undefined
      ? { usageCpuMilli: status.usageCpuMilli }
      : {}),
    sandboxRestarts:
      typeof restarts === "number" && Number.isFinite(restarts) && restarts > 0
        ? restarts
        : 0,
    sandboxRestartReason: status.sandboxRestartReason || undefined,
    sandboxNotReadyReason: status.sandboxNotReadyReason || undefined,
    sandboxReady: status.sandboxReady,
    gatewayReady: status.gatewayReady,
    gatewayNotReadyReason: status.gatewayNotReadyReason || undefined,
  };
}

export function assembleAgent(
  infra: InfraAgent,
  channels: ChannelConfig[],
  contributionFailures: DriverFailure[],
  globalIdleTimeoutMin: number,
  preparingWorkspace: boolean,
  templateUpdate: TemplateUpdate | undefined,
  features: RuntimeFeatures,
  unsupportedContributionKinds: ContributionKind[],
): Agent {
  return {
    id: infra.id,
    name: infra.name,
    templateId: infra.templateId,
    templateUpdate,
    spec: infra.spec,
    state: computeAgentState(infra, preparingWorkspace),
    effectiveHibernationTimeoutMin: resolveEffectiveHibernationTimeoutMin(
      infra.spec.hibernationTimeout,
      globalIdleTimeoutMin,
    ),
    error: infra.error,
    stopRequested: infra.stopRequested,
    overBudget: infra.overBudget,
    overBudgetMessage: infra.overBudgetMessage,
    sandboxTerminationReason: infra.sandboxTerminationReason,
    ...(infra.noCapacityMessage
      ? { noCapacityMessage: infra.noCapacityMessage }
      : {}),
    usage: {
      ...(infra.usageCpuMilli !== undefined
        ? { cpuMilli: infra.usageCpuMilli }
        : {}),
      ...(infra.usageMemoryBytes !== undefined
        ? { memoryBytes: infra.usageMemoryBytes }
        : {}),
    },
    contributionFailures,
    unsupportedContributionKinds,
    channels,
    kind: infra.kind,
    kbTemplateId: infra.kbTemplateId,
    features,
  };
}

export function buildAgentRecord(
  spec: Record<string, unknown>,
  owner: string,
  name: string,
  templateId?: string,
  annotations?: Record<string, string>,
): {
  id: string;
  owner: string;
  templateId?: string;
  annotations: Record<string, string>;
  spec: AgentSpecCR;
} {
  return {
    id: name,
    owner,
    ...(templateId ? { templateId } : {}),
    annotations: {
      [LAST_ACTIVITY_KEY]: new Date().toISOString(),
      ...annotations,
    },
    spec: spec as unknown as AgentSpecCR,
  };
}
