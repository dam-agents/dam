import type { Message } from "../../types.js";
import {
  frameMetaOf,
  PLATFORM_NOTIFICATION_METHODS,
  routeExtNotification,
} from "./ext-notifications.js";
import { applyUpdate, settleReplay } from "./session-projection.js";
import type { AcpUpdate, FrameMeta } from "./types.js";

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

const PLATFORM_METHODS: readonly string[] = PLATFORM_NOTIFICATION_METHODS;

function toUpdate(
  frame: unknown,
): { update: AcpUpdate; frame: FrameMeta } | null {
  if (isUpdateFrame(frame))
    return {
      update: frame.params.update,
      frame: frameMetaOf(frame.params._meta),
    };
  const { method, params } = (frame ?? {}) as {
    method?: unknown;
    params?: unknown;
  };
  if (
    typeof method !== "string" ||
    !PLATFORM_METHODS.includes(method) ||
    typeof params !== "object" ||
    params === null
  )
    return null;
  return routeExtNotification(method, params as Record<string, unknown>);
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
    const routed = toUpdate(frame);
    return routed ? applyUpdate(acc, routed.update, routed.frame) : acc;
  }, []);
  return settleReplay(messages, { turnInFlight: opts.turnInFlight ?? false });
}
