import type { ApprovalView } from "api-server-api";

const DENY_BATCH_SIZE = 500;

export function deniableApprovalIds(
  approvals: readonly ApprovalView[],
): string[] {
  return approvals
    .filter((a) => a.status === "pending" && a.type !== "spend_limit")
    .map((a) => a.id);
}

export function denyBatches(ids: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += DENY_BATCH_SIZE) {
    batches.push(ids.slice(i, i + DENY_BATCH_SIZE));
  }
  return batches;
}

export function denyAllPrompt(count: number): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  const noun = count === 1 ? "request" : "requests";
  return {
    title: `Deny ${String(count)} ${noun}?`,
    message: `Each ${noun === "request" ? "request is" : "of them is"} denied once. Nothing is remembered, so the agent asks again if it tries again.`,
    confirmLabel: `Deny ${String(count)}`,
  };
}
