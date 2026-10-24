import { match } from "ts-pattern";

export const RECONNECT_BACKOFF_MS: readonly number[] = [
  1_000, 2_000, 5_000, 10_000, 30_000,
];

export const RECONNECT_GIVE_UP_MS = 120_000;

export const AGENT_NOT_READY_REASON = "agent not ready";

export type TerminalDrop =
  | { kind: "exited"; code: number }
  | { kind: "closed"; code: number; reason: string }
  | { kind: "refused"; status: number }
  | { kind: "lost"; reason: string };

const TRANSIENT_CLOSE_CODES: ReadonlySet<number> = new Set([
  1001, 1006, 1012, 1013, 1014,
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: says whether a terminal viewer that lost its
 * connection connects again to the same Session by itself. A lost socket, a
 * relay that goes away or restarts (1001, 1012, 1013, 1014), an upgrade refused
 * with a 5xx, and a 1011 from the relay's side of the agent are transient. An
 * exit frame, a normal close (1000: the PTY exited, or a newer viewer
 * superseded this one), a refused lease (1008), a protocol error, an upgrade
 * refused with a 4xx (auth, ownership, terms), and a 1011 whose reason starts
 * with "agent not ready" (the agent is asleep, stopped, gone or would not wake)
 * end the attach, because a new attempt meets the same answer.
 */
export function terminalDropRetries(drop: TerminalDrop): boolean {
  return match(drop)
    .with({ kind: "exited" }, () => false)
    .with({ kind: "lost" }, () => true)
    .with({ kind: "refused" }, ({ status }) => status >= 500)
    .with({ kind: "closed" }, ({ code, reason }) =>
      code === 1011
        ? !reason.startsWith(AGENT_NOT_READY_REASON)
        : TRANSIENT_CLOSE_CODES.has(code),
    )
    .exhaustive();
}

export function describeTerminalDrop(drop: TerminalDrop): string {
  return match(drop)
    .with({ kind: "exited" }, ({ code }) => `process exited with code ${code}`)
    .with({ kind: "lost" }, ({ reason }) => reason)
    .with(
      { kind: "refused" },
      ({ status }) => `server refused the connection (HTTP ${status})`,
    )
    .with({ kind: "closed" }, ({ reason }) => reason || "connection closed")
    .exhaustive();
}

export interface ReconnectPolicy {
  backoffMs: readonly number[];
  giveUpMs: number;
}

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  backoffMs: RECONNECT_BACKOFF_MS,
  giveUpMs: RECONNECT_GIVE_UP_MS,
};

export interface ReconnectClock {
  attempt: number;
  since: number;
}

export type ReconnectStep =
  | { kind: "retry"; delayMs: number; reason: string; clock: ReconnectClock }
  | { kind: "end"; reason: string };

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a terminal viewer does after one of its
 * connections ends. It connects again only when the drop is transient and
 * some connection of this attach carried a frame, so a first connect that
 * fails is reported at once. The give-up clock starts at the drop of the last
 * connection that carried a frame: a new connection that opens and closes
 * again before the agent's end answers does not start it over.
 */
export function planReconnect(input: {
  drop: TerminalDrop;
  everLive: boolean;
  live: boolean;
  clock: ReconnectClock;
  now: number;
  policy?: ReconnectPolicy;
}): ReconnectStep {
  const policy = input.policy ?? DEFAULT_RECONNECT_POLICY;
  const reason = describeTerminalDrop(input.drop);
  if (!input.everLive || !terminalDropRetries(input.drop))
    return { kind: "end", reason };
  const clock = input.live ? { attempt: 0, since: input.now } : input.clock;
  const delayMs = nextReconnectDelay(
    clock.attempt,
    input.now - clock.since,
    policy,
  );
  if (delayMs === null)
    return {
      kind: "end",
      reason: `could not reconnect within ${Math.round(policy.giveUpMs / 1000)} s: ${reason}`,
    };
  return {
    kind: "retry",
    delayMs,
    reason,
    clock: { attempt: clock.attempt + 1, since: clock.since },
  };
}

export function nextReconnectDelay(
  attempt: number,
  elapsedMs: number,
  policy: ReconnectPolicy = DEFAULT_RECONNECT_POLICY,
): number | null {
  const steps = policy.backoffMs;
  const delay = steps[Math.min(attempt, steps.length - 1)] ?? 0;
  return elapsedMs + delay > policy.giveUpMs ? null : delay;
}
