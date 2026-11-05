import type { z } from "zod";
import type { SpendLimitScope, SpendUnit } from "../spend/types.js";
import type {
  agentChangeResultSchema,
  approvalActionOutcomeSchema,
  approvalListOptionsSchema,
  approvalStatusSchema,
  approvalTypeSchema,
} from "./schemas.js";

export type ApprovalType = z.infer<typeof approvalTypeSchema>;
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export type ApprovalVerdict = "allow_once" | "allow" | "deny_once" | "deny";

interface ExtAuthzPayload {
  kind: "ext_authz";
  host: string;
  port?: number;
  method: string;
  path: string;
  viaAgentId?: string;
  viaEnvironment?: string;
}

export type AcpPermissionOptionKind =
  "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface AcpPermissionOption {
  optionId: string;
  kind?: AcpPermissionOptionKind;
}

interface AcpNativePayload {
  kind: "acp_native";
  toolName: string;
  toolCallId?: string;
  args?: unknown;
  rpcId?: number | string;
  options?: AcpPermissionOption[];
  optionsWhole?: true;
}

export interface SpendLimitPayload {
  kind: "spend_limit";
  limitId: string;
  scope: SpendLimitScope;
  unit: SpendUnit;
  day: string;
  amountMicros: number;
  extensions: number;
}

export interface EgressProposalPayload {
  kind: "egress_proposal";
  host: string;
  port?: number;
  method: string;
  path: string;
  reason: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a change an assistant's token asked for, held
 * until its owner decides: the tRPC procedure and the exact arguments it will
 * run with, and — once the verdict allowed it — what became of the run.
 */
export interface AgentChangePayload {
  kind: "agent_change";
  procedure: string;
  title: string;
  detail: string;
  input: AgentChangeArguments;
  outcome?: AgentChangeResult;
}

export type ApprovalPayload =
  | ExtAuthzPayload
  | AcpNativePayload
  | SpendLimitPayload
  | EgressProposalPayload
  | AgentChangePayload;

export interface ApprovalView {
  id: string;
  type: ApprovalType;
  agentId: string;
  sessionId: string | null;
  payload: ApprovalPayload;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  verdict: ApprovalVerdict | null;
  status: ApprovalStatus;
}

export type ApprovalListOptions = z.infer<typeof approvalListOptionsSchema>;

export type ApprovalActionOutcome = z.infer<typeof approvalActionOutcomeSchema>;

export interface ApprovalDismissManyOutcome {
  applied: number;
}

export type AgentChangeResult = z.infer<typeof agentChangeResultSchema>;

/* UNIT_BOUNDARY_DESCRIPTION: the tRPC input a held change carries — whatever the procedure's arguments were, verbatim, which is why it is typed as the JSON it survives the round trip as. */
export type AgentChangeArguments = Record<string, unknown> | unknown[] | null;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the api-server's own record of a change an
 * assistant's token asked for — the gate files it, the owner's verdict runs it.
 */
export interface AgentChangeFiled {
  id: string;
  title: string;
  expiresAt: string;
}

export interface AgentChangeRequest {
  procedure: string;
  input: AgentChangeArguments;
}

export interface AgentChangeApprovals {
  request(change: AgentChangeRequest): Promise<AgentChangeFiled>;
}

export interface ApprovalsService {
  listForOwner(opts?: ApprovalListOptions): Promise<ApprovalView[]>;
  listForInstance(
    agentId: string,
    opts?: ApprovalListOptions,
  ): Promise<ApprovalView[]>;
  get(id: string): Promise<ApprovalView | null>;
  approveOnce(id: string): Promise<ApprovalActionOutcome>;
  approvePermanent(id: string): Promise<ApprovalActionOutcome>;
  approveHost(id: string): Promise<ApprovalActionOutcome>;
  denyForever(id: string): Promise<ApprovalActionOutcome>;
  dismiss(id: string): Promise<ApprovalActionOutcome>;
  dismissMany(ids: readonly string[]): Promise<ApprovalDismissManyOutcome>;
}
