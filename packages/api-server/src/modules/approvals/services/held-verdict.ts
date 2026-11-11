import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";

export const approvalChannelOf = (id: string) => `approval:${id}`;

export type SettledVerdict =
  | { verdict: "allow" | "deny"; reason: "hold-resolved" }
  | { verdict: "deny"; reason: "hold-withdrawn" }
  | { verdict: "deny"; reason: "hold-expired"; flipped: boolean };

// UNIT_BOUNDARY_DESCRIPTION: waits on a held request's approval until a verdict resolves it or the hold expires. A verdict wakes it on the approval's channel; a poll every fifteen seconds covers a missed wake. A call that owns its request (one the gate filed for it) expires the request when the hold runs out, so a late verdict finds it expired. A call that waits on a request it does not own (a child's rule its driver asked for) leaves the request open for the owner, and gives up when the request is withdrawn or gone.
export async function waitForVerdict(
  deps: {
    repo: Pick<ApprovalsRepository, "getPending" | "expirePending">;
    bus: RedisBus;
    holdSeconds: number;
  },
  id: string,
  { ownsRequest }: { ownsRequest: boolean } = { ownsRequest: true },
): Promise<SettledVerdict> {
  return new Promise<SettledVerdict>((resolve) => {
    let settled = false;
    const settle = (s: SettledVerdict) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(s);
    };

    const checkResolved = async () => {
      const row = await deps.repo.getPending(id);
      if (!ownsRequest && (!row || row.status === "expired"))
        return settle({ verdict: "deny", reason: "hold-withdrawn" });
      if (!row || row.status !== "resolved") return;
      settle({
        verdict:
          row.verdict === "allow" || row.verdict === "allow_once"
            ? "allow"
            : "deny",
        reason: "hold-resolved",
      });
    };

    const unsubscribe = deps.bus.subscribe(
      approvalChannelOf(id),
      () => void checkResolved(),
    );
    void checkResolved();

    const poll = setInterval(() => void checkResolved(), 15_000);
    poll.unref();

    const timeout = setTimeout(async () => {
      if (!ownsRequest)
        return settle({
          verdict: "deny",
          reason: "hold-expired",
          flipped: false,
        });
      const flipped = await deps.repo.expirePending(id).catch((err) => {
        getLogger().error(
          { pendingId: id, reason: formatError(err) },
          "egress.hold_expire_error",
        );
        return false;
      });
      settle({ verdict: "deny", reason: "hold-expired", flipped });
    }, deps.holdSeconds * 1000);
    timeout.unref();

    function cleanup() {
      unsubscribe();
      clearInterval(poll);
      clearTimeout(timeout);
    }
  });
}
