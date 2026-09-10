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
  stopRequested: boolean;
  overBudget: boolean;
  overBudgetMessage?: string;
  error?: string;
  errorReason?: string;
  sandboxTerminationReason?: string;
  sandboxRestarts: number;
  sandboxRestartReason?: string;
  sandboxNotReadyReason?: string;
  sandboxReady?: boolean;
  gatewayReady?: boolean;
  gatewayNotReadyReason?: string;
}

export function computeAgentState(
  infra: InfraAgent,
  preparingWorkspace = false,
): AgentState {
  if (infra.error) return "error";
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

export function parseInfraAgent(record: AgentRecord): InfraAgent {
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
