export type SessionStatus = "working" | "needs-approval" | "waiting";

export function resolveSessionStatus(input: {
  working: boolean;
  needsApproval: boolean;
}): SessionStatus {
  if (input.needsApproval) return "needs-approval";
  if (input.working) return "working";
  return "waiting";
}

export const SESSION_STATUS_DISPLAY: Record<
  SessionStatus,
  { dotClass: string; pulse: boolean; label: string }
> = {
  working: { dotClass: "bg-accent", pulse: true, label: "Working" },
  "needs-approval": {
    dotClass: "bg-danger",
    pulse: true,
    label: "Needs your approval",
  },
  waiting: { dotClass: "bg-success", pulse: false, label: "Waiting for you" },
};
