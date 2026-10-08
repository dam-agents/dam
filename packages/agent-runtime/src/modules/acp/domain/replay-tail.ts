import { isNonNullObject, parseFrame } from "./frames.js";

type FrameShape =
  | { kind: "chunk"; run: string }
  | { kind: "tool_call" | "tool_call_update"; toolCallId: string }
  | { kind: "other" };

const CHUNK_UPDATES = new Set([
  "user_message_chunk",
  "agent_message_chunk",
  "agent_thought_chunk",
]);

function sessionUpdateOf(line: string): Record<string, unknown> | null {
  const frame = parseFrame(line);
  if (!isNonNullObject(frame) || frame.method !== "session/update") return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  return isNonNullObject(params.update) ? params.update : null;
}

function shapeOf(line: string): FrameShape {
  const update = sessionUpdateOf(line);
  const kind = update?.sessionUpdate;
  if (!update || typeof kind !== "string") return { kind: "other" };
  if (CHUNK_UPDATES.has(kind)) {
    const messageId =
      typeof update.messageId === "string" ? update.messageId : "";
    return { kind: "chunk", run: `${kind}:${messageId}` };
  }
  if (
    (kind === "tool_call" || kind === "tool_call_update") &&
    typeof update.toolCallId === "string"
  ) {
    return { kind, toolCallId: update.toolCallId };
  }
  return { kind: "other" };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Picks where a replay of the newest `size` frames
 * starts. The plain cut is moved back so it never splits a run of one
 * message's chunks and never parts a tool call from its updates: the client
 * would show half a sentence, or drop updates for a tool call it never saw.
 * An update whose tool_call is not among the frames at all cannot be helped,
 * so it does not move the cut.
 */
export function tailStart(
  frames: readonly { line: string }[],
  size: number,
): number {
  if (frames.length <= size) return 0;
  const cut = frames.length - size;
  const shapes: FrameShape[] = [];
  const shapeAt = (i: number): FrameShape =>
    (shapes[i] ??= shapeOf(frames[i]!.line));
  const continuesRun = (i: number): boolean => {
    const here = shapeAt(i);
    const before = shapeAt(i - 1);
    return (
      here.kind === "chunk" &&
      before.kind === "chunk" &&
      here.run === before.run
    );
  };
  const walkBack = (ignored: ReadonlySet<string>) => {
    const unopened = new Set<string>();
    const include = (i: number): void => {
      const shape = shapeAt(i);
      if (shape.kind === "tool_call") unopened.delete(shape.toolCallId);
      else if (
        shape.kind === "tool_call_update" &&
        !ignored.has(shape.toolCallId)
      )
        unopened.add(shape.toolCallId);
    };
    for (let i = frames.length - 1; i >= cut; i--) include(i);
    let start = cut;
    while (start > 0 && (unopened.size > 0 || continuesRun(start))) {
      start -= 1;
      include(start);
    }
    return { start, unopened };
  };
  const first = walkBack(new Set());
  return first.unopened.size === 0
    ? first.start
    : walkBack(first.unopened).start;
}
