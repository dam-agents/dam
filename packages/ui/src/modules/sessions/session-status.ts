export type SessionStatus =
  | "working"
  | "needs-approval"
  | "waiting"
  | "terminal";

export function resolveSessionStatus(input: {
  working: boolean;
  needsApproval: boolean;
  isTerminal: boolean;
}): SessionStatus {
  // A terminal PTY has no ACP turn, so it's neutral — but a blocked-on-you approval still wins.
  if (input.needsApproval) return "needs-approval";
  if (input.isTerminal) return "terminal";
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
  terminal: { dotClass: "bg-text-muted", pulse: false, label: "Terminal" },
};
