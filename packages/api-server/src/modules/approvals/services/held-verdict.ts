import { randomUUID } from "node:crypto";
import type { OwnerRoute } from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";
import { emit, EventType } from "../../../events.js";

export const approvalChannelOf = (id: string) => `approval:${id}`;

export const turnReleaseChannelOf = (agentId: string) =>
  `turn-release:${agentId}`;

// UNIT_BOUNDARY_DESCRIPTION: what a "Don't wait" press sends on the agent's release channel: when the released turn began, and the Sessions it ran on. A wait that began before the turn did is not this turn's, and a web search that names a Session outside the list came from another conversation.
export interface TurnRelease {
  readonly turnStartedAt: number;
  readonly sessionIds: readonly string[];
}

export type SettledVerdict =
  | { verdict: "allow" | "deny"; reason: "hold-resolved" }
  | { verdict: "deny"; reason: "hold-withdrawn" }
  | { verdict: "deny"; reason: "hold-abandoned" }
  | { verdict: "deny"; reason: "hold-released" }
  | { verdict: "deny"; reason: "hold-expired"; flipped: boolean };

// UNIT_BOUNDARY_DESCRIPTION: how many held requests still wait for each approval's answer, across api-server replicas. Each wait enters under its own id with a lease that it renews while it waits, so the waits of a replica that died drop out when their lease runs out. Enter and leave return the count after the change.
export interface HoldWaiters {
  enter(approvalId: string, waitId: string): Promise<number>;
  leave(approvalId: string, waitId: string): Promise<number>;
  count(approvalId: string): Promise<number>;
}

const WAIT_LEASE_RENEW_MS = 30_000;

const RELEASE_REASON = "hold-released";

function releaseOf(raw: string): TurnRelease | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TurnRelease>;
    if (
      typeof parsed.turnStartedAt !== "number" ||
      !Array.isArray(parsed.sessionIds)
    )
      return null;
    return {
      turnStartedAt: parsed.turnStartedAt,
      sessionIds: parsed.sessionIds.filter(
        (id): id is string => typeof id === "string",
      ),
    };
  } catch {
    return null;
  }
}

// UNIT_BOUNDARY_DESCRIPTION: waits on a held request's approval until a verdict resolves it or the hold expires. A verdict wakes it on the approval's channel; a poll every fifteen seconds covers a missed wake. The wait ends at `expiresAt` when given, else after the hold window; when the timer fires, a request that owns its approval reads the row again and waits on when the row's expiry moved, because a request of an addressed Slack turn that joined it raised it; otherwise it expires the request, but only when the row's expiry has passed, so a late verdict finds it expired. A call that waits on a request it does not own (a child's rule its driver asked for) leaves the request open for the owner, and gives up when the request is withdrawn or gone. When `signal` aborts, the client that sent the held request has gone away: the wait ends at once and leaves the request as it is, pending for the owner and for an identical retry to join. With `release`, a "Don't wait" press of the agent's Slack turn ends the wait the same way, when the wait began after that turn did and, for a request that names a Session, the turn ran on it. With `tracked` and a waiter count, the wait is counted while it lasts, and `ApprovalWaitChanged` says when the first wait starts and when the last one ends without a verdict.
export async function waitForVerdict(
  deps: {
    repo: Pick<ApprovalsRepository, "getPending" | "expirePending">;
    bus: RedisBus;
    holdSeconds: number;
    waiters?: HoldWaiters;
  },
  id: string,
  {
    ownsRequest = true,
    signal,
    expiresAt,
    release,
    tracked,
  }: {
    ownsRequest?: boolean;
    signal?: AbortSignal;
    expiresAt?: Date;
    release?: { agentId: string; sessionId?: string | null };
    tracked?: { agentId: string; ownerSub: string; route: OwnerRoute };
  } = {},
): Promise<SettledVerdict> {
  const holdMs = deps.holdSeconds * 1000;
  const startedAt = Date.now();
  const waitMs = expiresAt
    ? Math.max(0, expiresAt.getTime() - startedAt)
    : holdMs;
  const waitId = randomUUID();
  const counter = tracked ? deps.waiters : undefined;

  const waitChanged = (waiting: boolean) => {
    if (!tracked) return;
    emit({
      type: EventType.ApprovalWaitChanged,
      approvalId: id,
      agentId: tracked.agentId,
      ownerSub: tracked.ownerSub,
      ownerRoute: tracked.route,
      waiting,
    });
  };

  const countFailed = (err: unknown) => {
    getLogger().warn(
      { pendingId: id, reason: formatError(err) },
      "egress.hold_wait_count_error",
    );
    return null;
  };

  const settledVerdict = await new Promise<SettledVerdict>((resolve) => {
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

    const unsubscribeRelease = release
      ? deps.bus.subscribe(turnReleaseChannelOf(release.agentId), (raw) => {
          const turn = releaseOf(raw);
          if (!turn || startedAt < turn.turnStartedAt) return;
          if (release.sessionId && !turn.sessionIds.includes(release.sessionId))
            return;
          settle({ verdict: "deny", reason: RELEASE_REASON });
        })
      : () => {};

    const poll = setInterval(() => void checkResolved(), 15_000);
    poll.unref();

    const renew = counter
      ? setInterval(
          () => void counter.enter(id, waitId).catch(countFailed),
          WAIT_LEASE_RENEW_MS,
        )
      : undefined;
    renew?.unref();

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const arm = (ms: number) => {
      timeout = setTimeout(() => void timeUp(), ms);
      timeout.unref();
    };
    const timeUp = async () => {
      if (!ownsRequest)
        return settle({
          verdict: "deny",
          reason: "hold-expired",
          flipped: false,
        });
      const row = await deps.repo.getPending(id).catch(() => null);
      const left = row ? row.expiresAt.getTime() - Date.now() : 0;
      if (row?.status === "pending" && left > 0) return arm(left);
      if (row?.status === "resolved") return void checkResolved();
      const flipped = await deps.repo
        .expirePending(id, { onlyIfDue: true })
        .catch((err) => {
          getLogger().error(
            { pendingId: id, reason: formatError(err) },
            "egress.hold_expire_error",
          );
          return false;
        });
      settle({ verdict: "deny", reason: "hold-expired", flipped });
    };
    arm(waitMs);

    const abandon = () => settle({ verdict: "deny", reason: "hold-abandoned" });
    if (signal?.aborted) abandon();
    else signal?.addEventListener("abort", abandon, { once: true });

    function cleanup() {
      signal?.removeEventListener("abort", abandon);
      unsubscribe();
      unsubscribeRelease();
      clearInterval(poll);
      if (renew) clearInterval(renew);
      clearTimeout(timeout);
    }

    if (counter && !settled)
      void counter
        .enter(id, waitId)
        .then((count) => {
          if (count === 1) waitChanged(true);
        })
        .catch(countFailed);
  });

  if (counter) {
    const left = await counter.leave(id, waitId).catch(countFailed);
    const unanswered =
      settledVerdict.reason === "hold-abandoned" ||
      settledVerdict.reason === RELEASE_REASON;
    if (left === 0 && unanswered) waitChanged(false);
  }
  return settledVerdict;
}
