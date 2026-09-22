import type { z } from "zod";
import type {
  approvalActionOutcomeSchema,
  approvalListOptionsSchema,
  approvalStatusSchema,
} from "./schemas.js";

export type ApprovalType = "ext_authz" | "acp_native" | "satellite_job";

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export type ApprovalVerdict = "allow_once" | "allow" | "deny_once" | "deny";

export interface ExtAuthzPayload {
  kind: "ext_authz";
  host: string;
  method: string;
  path: string;
  viaAgentId?: string;
}

export type AcpPermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

export interface AcpPermissionOption {
  optionId: string;
  kind?: AcpPermissionOptionKind;
}

export interface AcpNativePayload {
  kind: "acp_native";
  toolName: string;
  args?: unknown;
  rpcId?: number | string;
  options?: AcpPermissionOption[];
}

export interface SatelliteJobPayload {
  kind: "satellite_job";
  satellite: string;
  sequence: number;
  ref: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
}

export type ApprovalPayload =
  | ExtAuthzPayload
  | AcpNativePayload
  | SatelliteJobPayload;

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

export interface ApprovalsService {
  get(id: string): Promise<ApprovalView | null>;
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
}
