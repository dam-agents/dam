import type {
  ApprovalPayload,
  ApprovalStatus,
  ApprovalType,
  ApprovalVerdict,
  OwnerRoute,
} from "api-server-api";

export interface PendingApprovalRow {
  id: string;
  type: ApprovalType;
  agentId: string;
  ownerSub: string;
  sessionId: string | null;
  payload: ApprovalPayload;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  verdict: ApprovalVerdict | null;
  decidedBy: string | null;
  status: ApprovalStatus;
  deliveredAt: Date | null;
  ownerRoute?: OwnerRoute | null;
}
