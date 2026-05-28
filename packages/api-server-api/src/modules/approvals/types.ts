import type { z } from "zod";
import type {
  approvalListOptionsSchema,
  approvalStatusSchema,
} from "./schemas.js";

export type ApprovalType = "ext_authz" | "acp_native";

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

/** Verdict the user picked. `allow_once` / `deny_once` resolve only the
 *  held call (no rule written) so a future request from the same shape
 *  re-prompts; `allow` / `deny` write a permanent egress rule via the
 *  egress-rules module. The gate treats `deny_once` like `deny` (denies
 *  the held call); the difference is purely whether a rule is written. */
export type ApprovalVerdict = "allow_once" | "allow" | "deny_once" | "deny";

export interface ExtAuthzPayload {
  kind: "ext_authz";
  host: string;
  method: string;
  path: string;
}

/** ACP `PermissionOption.kind` values the harness emits. */
export type AcpPermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

export interface AcpPermissionOption {
  optionId: string;
  kind?: AcpPermissionOptionKind;
}

/** Captured at relay-mirror time so the inbox can synthesize a JSON-RPC
 *  response frame for the held wrapper request without a second round-trip
 *  back to the wrapper. The harness's option ids vary; we map our action
 *  (approveOnce / approvePermanent / denyForever) to the closest `kind`. */
export interface AcpNativePayload {
  kind: "acp_native";
  toolName: string;
  args?: unknown;
  rpcId?: number | string;
  options?: AcpPermissionOption[];
}

export type ApprovalPayload = ExtAuthzPayload | AcpNativePayload;

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

/** Shared options for the two `list*` procedures: server clamps `limit`
 *  to a safe upper bound, and `status` omitted means "include all"
 *  (subject to `limit`). The inbox always shows pending first; resolved
 *  and expired rows are capped to keep the list from growing unbounded. */
export type ApprovalListOptions = z.infer<typeof approvalListOptionsSchema>;

export interface ApprovalsService {
  listForOwner(opts?: ApprovalListOptions): Promise<ApprovalView[]>;
  listForInstance(
    agentId: string,
    opts?: ApprovalListOptions,
  ): Promise<ApprovalView[]>;
  approveOnce(id: string): Promise<void>;
  approvePermanent(id: string): Promise<void>;
  /** Wildcard-host variant of approve-permanent: writes a single rule that
   *  matches any method/path on the request's host. Only meaningful for
   *  ext_authz approvals — for acp_native, falls back to approvePermanent. */
  approveHost(id: string): Promise<void>;
  denyForever(id: string): Promise<void>;
  /** "Deny but ask again" — resolves the held call with deny and writes
   *  no rule, so the next request of the same shape re-prompts. Use for
   *  one-off rejections where the user doesn't want a permanent rule. */
  dismiss(id: string): Promise<void>;
}
