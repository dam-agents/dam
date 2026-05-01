import type { ApprovalPayload, ApprovalStatus, ApprovalType } from "api-server-api";

export interface PendingApprovalRow {
  id: string;
  type: ApprovalType;
  instanceId: string;
  agentId: string;
  ownerSub: string;
  sessionId: string | null;
  payload: ApprovalPayload;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  verdict: "allow_once" | "allow" | "deny" | null;
  decidedBy: string | null;
  status: ApprovalStatus;
  deliveredAt: Date | null;
}
