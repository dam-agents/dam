import type { Message } from "../../../types.js";
import type { AcpUpdate } from "../../acp/types.js";

const MINUTE_MS = 60_000;
const TOOL_QUIET_MS = 2 * MINUTE_MS;
const MODEL_QUIET_MS = MINUTE_MS;
const MAYBE_STUCK_MS = 5 * MINUTE_MS;

export type QuietTurn =
  | { kind: "tool"; quietMs: number }
  | { kind: "model"; quietMs: number }
  | { kind: "maybe-stuck"; quietMs: number };

export function isOutputFrame(update: AcpUpdate): boolean {
  if (update.sessionUpdate === "user_message_chunk")
    return update._meta?.queued !== true;
  if (update.sessionUpdate === "platform_prompt_accepted")
    return !update.queued;
  if (update.sessionUpdate === "tool_call_update")
    return (
      (update.content?.length ?? 0) > 0 ||
      update.rawOutput !== undefined ||
      update.status === "completed" ||
      update.status === "failed"
    );
  const kind = update.sessionUpdate;
  if (kind === "platform_prompt_started" || kind === "platform_turn_started")
    return true;
  return !kind.startsWith("platform_") && kind !== "config_option_update";
}

export function lastOutputAtOf(
  updates: readonly { update: AcpUpdate; frame: { at?: string } }[],
  since: string | null,
): string | null {
  let last = since;
  for (const { update, frame } of updates) {
    if (frame.at === undefined || !isOutputFrame(update)) continue;
    if (last === null || Date.parse(frame.at) > Date.parse(last))
      last = frame.at;
  }
  return last;
}

function isOpenTool(part: Message["parts"][number]): boolean {
  return (
    part.kind === "tool" &&
    (part.status === "pending" ||
      part.status === "in_progress" ||
      part.status === "running")
  );
}

function laterOf(a: string | null, b: string | undefined): string | null {
  if (b === undefined) return a;
  return a === null || Date.parse(b) > Date.parse(a) ? b : a;
}

function runningTurnOf(
  messages: readonly Message[],
): { turn: Message; opening: Message | undefined } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const turn = messages[i];
    if (turn?.role !== "assistant" || !turn.streaming || turn.queued) continue;
    const opening = messages
      .slice(0, i)
      .reverse()
      .find((m) => m.role === "user");
    return { turn, opening };
  }
  return null;
}

export function quietTurnOf({
  messages,
  lastOutputAt,
  now,
}: {
  messages: readonly Message[];
  lastOutputAt: string | null;
  now: Date;
}): QuietTurn | null {
  const running = runningTurnOf(messages);
  if (running === null) return null;
  const { turn, opening } = running;
  const since = laterOf(lastOutputAt, opening?.at);
  if (since === null) return null;
  const quietMs = now.getTime() - Date.parse(since);
  if (turn.parts.some(isOpenTool))
    return quietMs >= TOOL_QUIET_MS ? { kind: "tool", quietMs } : null;
  if (quietMs >= MAYBE_STUCK_MS) return { kind: "maybe-stuck", quietMs };
  if (quietMs >= MODEL_QUIET_MS) return { kind: "model", quietMs };
  return null;
}

export function quietLabel(ms: number): string {
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? `${String(hours)} h`
    : `${String(hours)} h ${String(rest)} min`;
}

export interface QuietTurnCopy {
  tone: "warning" | "muted";
  lead: string;
  rest: string;
}

export function quietTurnCopy(quiet: QuietTurn): QuietTurnCopy {
  const quietFor = quietLabel(quiet.quietMs);
  switch (quiet.kind) {
    case "tool":
      return {
        tone: "muted",
        lead: "The step above",
        rest: `has been running for ${quietFor}.`,
      };
    case "model":
      return {
        tone: "muted",
        lead: "Waiting on the model,",
        rest: `no output for ${quietFor}.`,
      };
    case "maybe-stuck":
      return {
        tone: "warning",
        lead: `No output from the agent for ${quietFor}.`,
        rest: "It may be stuck.",
      };
  }
}
