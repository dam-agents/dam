import type { Message } from "../../types.js";
import { frameMetaOf } from "./ext-notifications.js";
import { applyUpdate, settleReplay } from "./session-projection.js";
import type { AcpUpdate } from "./types.js";

interface UpdateFrame {
  params: { update: AcpUpdate; _meta?: unknown };
}

function isUpdateFrame(value: unknown): value is UpdateFrame {
  if (typeof value !== "object" || value === null) return false;
  const params = (value as { params?: unknown }).params;
  if (typeof params !== "object" || params === null) return false;
  const update = (params as { update?: unknown }).update;
  return (
    typeof update === "object" && update !== null && "sessionUpdate" in update
  );
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function kindOf(frame: unknown): string | null {
  return isUpdateFrame(frame) ? frame.params.update.sessionUpdate : null;
}

function tailStart(frames: readonly unknown[], tail: number): number {
  for (let i = frames.length - tail; i > 0; i--)
    if (
      kindOf(frames[i]) === "user_message_chunk" &&
      kindOf(frames[i - 1]) !== "user_message_chunk"
    )
      return i;
  return 0;
}

export function framesToMessages(
  lines: readonly string[],
  opts: { tail?: number; turnInFlight?: boolean } = {},
): Message[] {
  const frames = lines.map(parseLine);
  const from = opts.tail === undefined ? 0 : tailStart(frames, opts.tail);
  const messages = frames.slice(from).reduce<Message[]>((acc, frame) => {
    if (!isUpdateFrame(frame)) return acc;
    return applyUpdate(
      acc,
      frame.params.update,
      frameMetaOf(frame.params._meta),
    );
  }, []);
  return settleReplay(messages, { turnInFlight: opts.turnInFlight ?? false });
}
