import { stripContinuedFrom } from "./continued-from.js";
import { isNonNullObject, parseFrame } from "./frames.js";

export type RewriteCut =
  | { kind: "start" }
  | { kind: "after"; entry: string; batch?: string }
  | { kind: "missing" }
  | { kind: "absent" };

interface UpdateFrame {
  line: string;
  update: Record<string, unknown>;
  platform: Record<string, unknown>;
}

interface UserMessage {
  ids: Set<string>;
  text: string;
  first: number;
}

function updateFrameOf(line: string): UpdateFrame | null {
  const frame = parseFrame(line);
  if (!isNonNullObject(frame) || frame.method !== "session/update") return null;
  const params = frame.params;
  if (!isNonNullObject(params) || !isNonNullObject(params.update)) return null;
  const meta = isNonNullObject(params._meta) ? params._meta : {};
  const platform = isNonNullObject(meta.platform) ? meta.platform : {};
  return { line, update: params.update, platform };
}

function updateFramesOf(lines: readonly string[]): UpdateFrame[] {
  return lines.flatMap((line) => updateFrameOf(line) ?? []);
}

function textOf(update: Record<string, unknown>): string {
  const content = update.content;
  return isNonNullObject(content) &&
    content.type === "text" &&
    typeof content.text === "string"
    ? content.text
    : "";
}

function userMessagesOf(frames: readonly UpdateFrame[]): UserMessage[] {
  const messages: UserMessage[] = [];
  let open: UserMessage | null = null;
  frames.forEach((frame, index) => {
    const { update } = frame;
    const id = update.messageId;
    if (
      update.sessionUpdate !== "user_message_chunk" ||
      typeof id !== "string"
    ) {
      open = null;
      return;
    }
    if (open !== null) {
      open.ids.add(id);
      open.text += textOf(update);
      return;
    }
    open = { ids: new Set([id]), text: textOf(update), first: index };
    messages.push(open);
  });
  return messages.map((m) => ({
    ...m,
    text: stripContinuedFrom(m.text).replace(/\s+/g, " ").trim(),
  }));
}

function laterWithSameText(
  messages: readonly UserMessage[],
  target: UserMessage,
): number {
  const at = messages.indexOf(target);
  return messages.slice(at + 1).filter((m) => m.text === target.text).length;
}

function historyMessageFor(
  history: readonly UserMessage[],
  log: readonly UserMessage[],
  messageId: string,
): UserMessage | null {
  const direct = history.find((m) => m.ids.has(messageId));
  if (direct) return direct;
  const sent = log.find((m) => m.ids.has(messageId));
  if (!sent || sent.text === "") return null;
  const later = laterWithSameText(log, sent);
  const sameText = history.filter((m) => m.text === sent.text);
  return sameText[sameText.length - 1 - later] ?? null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Finds where a rewind or fork cuts the harness's
 * own history: right before the user message being rewritten, whatever sits
 * above it — an agent reply or a tool result. User messages with nothing
 * between them are one unit: a batch the harness took as one message, which
 * a rewrite replaces whole. The history is the session-history provider's replay,
 * each frame stamped with the harness entry it came from (`platform.entry`).
 * The message is named by the id the client shows: the harness's own id after
 * a cold load, or the sender's prompt id for a message the runtime's log
 * echoed live, which is matched to the history by text and by how many later
 * messages share that text. Null when the history carries no entry stamps,
 * so the caller falls back to the client's own cut.
 */
export function rewriteCutOf(
  historyLines: readonly string[],
  logLines: readonly string[],
  messageId: string,
): RewriteCut | null {
  const frames = updateFramesOf(historyLines);
  if (!frames.some((f) => typeof f.platform.entry === "string")) return null;
  const target = historyMessageFor(
    userMessagesOf(frames),
    userMessagesOf(updateFramesOf(logLines)),
    messageId,
  );
  if (target === null) return { kind: "missing" };
  return cutAbove(frames, target.first);
}

const AGENT_OUTPUT = new Set([
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
  "plan",
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Where taking back the newest message cuts the
 * harness's own history: right before its last batch of user messages. A
 * stopped turn adds the harness's own note of the stop to that batch, so the
 * batch is taken by its place and only checked to hold the message — by id,
 * or by containing the text the runtime's log echoed for it. Absent when the
 * batch does not hold it, as when the harness dropped a prompt stopped before
 * it began; missing when the agent already wrote after it; null when the
 * history carries no entry stamps.
 */
export function takeBackCutOf(
  historyLines: readonly string[],
  logLines: readonly string[],
  messageId: string,
): RewriteCut | null {
  const frames = updateFramesOf(historyLines);
  if (!frames.some((f) => typeof f.platform.entry === "string")) return null;
  const last = userMessagesOf(frames).at(-1);
  if (last === undefined) return { kind: "absent" };
  const sent = userMessagesOf(updateFramesOf(logLines)).find((m) =>
    m.ids.has(messageId),
  );
  const holdsMessage =
    last.ids.has(messageId) ||
    (sent !== undefined && sent.text !== "" && last.text.includes(sent.text));
  const answered = frames
    .slice(last.first)
    .some((f) => AGENT_OUTPUT.has(String(f.update.sessionUpdate)));
  if (!holdsMessage) return { kind: "absent" };
  if (answered) return { kind: "missing" };
  return cutAbove(frames, last.first);
}

function cutAbove(frames: readonly UpdateFrame[], index: number): RewriteCut {
  const above = frames
    .slice(0, index)
    .reverse()
    .find((f) => typeof f.platform.entry === "string");
  if (!above) return { kind: "start" };
  const batch = frames[index]?.platform.entry;
  return {
    kind: "after",
    entry: above.platform.entry as string,
    ...(typeof batch === "string" && { batch }),
  };
}

function sameFrame(a: UpdateFrame, b: UpdateFrame): boolean {
  return (
    a.update.sessionUpdate === b.update.sessionUpdate &&
    textOf(a.update) === textOf(b.update)
  );
}

function withAt(line: string, at: string): string {
  const frame = JSON.parse(line) as {
    params: { _meta?: { platform?: Record<string, unknown> } };
  };
  const meta = frame.params._meta ?? {};
  frame.params._meta = { ...meta, platform: { ...meta.platform, at } };
  return JSON.stringify(frame);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Gives a forked copy's history the times of the
 * session it was cut from. The harness stamps the last entry it copies with
 * the time of the fork, so that entry would read as written today; every
 * other copied entry keeps its time. The copy's replay is a prefix of the
 * original's, frame for frame, so each frame takes the original's time while
 * the two still agree; from the first difference on, nothing is changed.
 */
export function withOriginalTimes(
  copyLines: readonly string[],
  originalLines: readonly string[],
): string[] {
  const original = updateFramesOf(originalLines);
  let index = 0;
  let agreeing = true;
  return copyLines.map((line) => {
    const frame = updateFrameOf(line);
    if (!agreeing || frame === null) return line;
    const source = original[index++];
    if (!source || !sameFrame(frame, source)) {
      agreeing = false;
      return line;
    }
    const at = source.platform.at;
    return typeof at === "string" && at !== frame.platform.at
      ? withAt(line, at)
      : line;
  });
}
