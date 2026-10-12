import type { Message } from "../../../types.js";
import {
  frameMetaOf,
  PLATFORM_NOTIFICATION_METHODS,
  routeExtNotification,
} from "../../acp/ext-notifications.js";
import { applyUpdate, settleReplay } from "../../acp/session-projection.js";
import type { AcpUpdate, FrameMeta } from "../../acp/types.js";

const PREVIEW_TAIL_FRAMES = 200;

interface Frame {
  method?: unknown;
  params?: { update?: AcpUpdate; _meta?: unknown } & Record<string, unknown>;
}

function parseFrame(line: string): Frame | null {
  try {
    const frame: unknown = JSON.parse(line);
    return typeof frame === "object" && frame !== null
      ? (frame as Frame)
      : null;
  } catch {
    return null;
  }
}

function toUpdate(
  frame: Frame,
): { update: AcpUpdate; frame: FrameMeta } | null {
  if (!frame.params) return null;
  if (frame.method === "session/update" && frame.params.update)
    return {
      update: frame.params.update,
      frame: frameMetaOf(frame.params._meta),
    };
  if (
    typeof frame.method === "string" &&
    (PLATFORM_NOTIFICATION_METHODS as readonly string[]).includes(frame.method)
  )
    return routeExtNotification(frame.method, frame.params);
  return null;
}

function opensTurn(frames: readonly (Frame | null)[], i: number): boolean {
  const kind = (f: Frame | null | undefined) =>
    f?.method === "session/update" ? f.params?.update?.sessionUpdate : null;
  return (
    kind(frames[i]) === "user_message_chunk" &&
    kind(frames[i - 1]) !== "user_message_chunk"
  );
}

function tailStart(frames: readonly (Frame | null)[]): number {
  for (let i = frames.length - PREVIEW_TAIL_FRAMES; i > 0; i--)
    if (opensTurn(frames, i)) return i;
  return 0;
}

export function previewFromHistory(
  lines: readonly string[],
  { turnInFlight }: { turnInFlight: boolean },
): Message[] {
  const frames = lines.map(parseFrame);
  const messages = frames
    .slice(tailStart(frames))
    .reduce<Message[]>((acc, frame) => {
      const routed = frame && toUpdate(frame);
      return routed ? applyUpdate(acc, routed.update, routed.frame) : acc;
    }, []);
  return settleReplay(messages, { turnInFlight });
}
