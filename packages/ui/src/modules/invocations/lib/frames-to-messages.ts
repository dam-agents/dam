import type { Message } from "../../../types.js";
import { frameMetaOf } from "../../acp/ext-notifications.js";
import { applyUpdate, settleReplay } from "../../acp/session-projection.js";
import type { AcpUpdate } from "../../acp/types.js";

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

export function framesToMessages(frames: readonly string[]): Message[] {
  const messages = frames.reduce<Message[]>((acc, line) => {
    const frame = parseLine(line);
    if (!isUpdateFrame(frame)) return acc;
    const meta = frameMetaOf(frame.params._meta);
    return applyUpdate(
      acc,
      frame.params.update,
      meta.at,
      meta.telemetryPromptId,
    );
  }, []);
  return settleReplay(messages, { turnInFlight: false });
}
