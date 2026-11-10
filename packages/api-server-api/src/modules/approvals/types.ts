import type { z } from "zod";
import type { SpendLimitScope, SpendUnit } from "../spend/types.js";
import type {
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
  // UNIT_BOUNDARY_DESCRIPTION: the parent whose page shows this prompt, when it came from a child whose scoped egress only the user may widen; approving widens the child's rules, never the parent's.
  forAgentId?: string;
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
  // UNIT_BOUNDARY_DESCRIPTION: the agent that asked for this rule on its child (the child is the row's agent), whose page shows the request; approving writes the rule onto the child alone.
  forAgentId?: string;
  // UNIT_BOUNDARY_DESCRIPTION: the rule reaches a host the asking agent does not reach itself; approving it also lets the sub-agents and Environments of that agent's launch root have network access of their own from then on.
  widerThanDriver?: true;
}

export type ApprovalPayload =
  | ExtAuthzPayload
  | AcpNativePayload
  | SpendLimitPayload
  | EgressProposalPayload;

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

export interface ApprovalsService {
  listForOwner(opts?: ApprovalListOptions): Promise<ApprovalView[]>;
  listForInstance(
    agentId: string,
    opts?: ApprovalListOptions,
  ): Promise<ApprovalView[]>;
  approveOnce(id: string): Promise<ApprovalActionOutcome>;
  approvePermanent(id: string): Promise<ApprovalActionOutcome>;
  approveHost(id: string): Promise<ApprovalActionOutcome>;
  denyForever(id: string): Promise<ApprovalActionOutcome>;
  dismiss(id: string): Promise<ApprovalActionOutcome>;
  dismissMany(ids: readonly string[]): Promise<ApprovalDismissManyOutcome>;
}
