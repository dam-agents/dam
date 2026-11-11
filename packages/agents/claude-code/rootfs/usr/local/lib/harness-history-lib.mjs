import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const adapter = "/usr/local/lib/harness/claude-code/adapter";
const modulesPromise = Promise.all([
  import(`${adapter}/sdk-to-acp.js`),
  import(`${adapter}/message-filters.js`),
  import(`${adapter}/claude-agent-sdk.js`),
]).then(([toAcp, filters, sdk]) => ({ agent: { ...toAcp, ...filters }, sdk }));
modulesPromise.catch(() => {});

function parentToolUseIdOf(message) {
  const id = message.parent_tool_use_id;
  return typeof id === "string" ? id : null;
}

function stripSubagentTextAndThinking(content) {
  if (!Array.isArray(content)) return content;
  return content.filter(
    (item) =>
      !item ||
      typeof item !== "object" ||
      !("type" in item) ||
      (item.type !== "text" && item.type !== "thinking"),
  );
}

function isNoResponseFiller(message) {
  const content = message.content;
  return (
    message.model === "<synthetic>" &&
    Array.isArray(content) &&
    content.length === 1 &&
    content[0]?.type === "text" &&
    content[0].text === "No response requested."
  );
}

function stampOf(message) {
  const timestamp = message.timestamp;
  return typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
    ? timestamp
    : null;
}

function isUserText(notification) {
  const update = notification?.update;
  return (
    update?.sessionUpdate === "user_message_chunk" &&
    update.content?.type === "text"
  );
}

function objectOr(value) {
  return typeof value === "object" && value !== null ? value : {};
}

function promptIdOf(message) {
  const id = message.promptId;
  return typeof id === "string" && id !== "" ? id : null;
}

function isToolResultOnly(content) {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((item) => item?.type === "tool_result")
  );
}

function modelOf(message, parentToolUseId) {
  if (message.type !== "assistant" || parentToolUseId) return null;
  const model = message.message.model;
  return typeof model === "string" && model !== "" && model !== "<synthetic>"
    ? model
    : null;
}

function withStamp(notification, entry, block, at, telemetryPromptId, model) {
  const meta = objectOr(notification._meta);
  return {
    ...notification,
    _meta: {
      ...meta,
      platform: {
        ...objectOr(meta.platform),
        ...(entry ? { entry } : {}),
        ...(block > 0 ? { block } : {}),
        ...(at !== null ? { at } : {}),
        ...(telemetryPromptId !== null ? { telemetryPromptId } : {}),
        ...(model !== null ? { model } : {}),
      },
    },
  };
}

const noop = () => {};
const noopLogger = {
  log: noop,
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
};
const noopClient = { sessionUpdate: async () => {} };

function framesOf(agent, sessionId, messages) {
  const toolUseCache = {};
  const taskState = new Map();
  const lines = [];
  let telemetryPromptId = null;

  for (const message of messages) {
    const messageId = agent.messageIdForGrouping(message);
    if (
      message.type === "assistant" &&
      (agent.isSyntheticLoginMessage(message.message) ||
        isNoResponseFiller(message.message))
    ) {
      continue;
    }
    const at = stampOf(message);
    let content = message.message.content;
    const parentToolUseId = parentToolUseIdOf(message);
    if (isPrompt(message)) {
      telemetryPromptId = promptIdOf(message);
    }
    if (message.type === "assistant" && parentToolUseId) {
      content = stripSubagentTextAndThinking(content);
    }
    if (message.message.role === "user") {
      content = agent.stripLocalCommandMetadata(content);
      if (content === null) continue;
    }
    let userTextBlock = 0;
    for (const notification of agent.toAcpNotifications(
      content,
      message.message.role,
      sessionId,
      toolUseCache,
      noopClient,
      noopLogger,
      {
        registerHooks: false,
        cwd: process.cwd(),
        taskState,
        messageId,
        parentToolUseId,
      },
    )) {
      lines.push(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: withStamp(
            notification,
            messageId,
            isUserText(notification) ? userTextBlock++ : 0,
            at,
            telemetryPromptId,
            modelOf(message, parentToolUseId),
          ),
        }),
      );
    }
  }
  return lines;
}

function isPrompt(message) {
  return (
    message.type === "user" &&
    parentToolUseIdOf(message) === null &&
    !isToolResultOnly(message.message.content)
  );
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK_BYTES = 1 << 20;
const REQUEST_RECORD = Buffer.from('{"type":"api-request');

async function transcriptPath(sessionId) {
  if (!SESSION_ID.test(sessionId)) return null;
  const root = join(
    process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
    "projects",
  );
  for (const dir of await readdir(root).catch(() => [])) {
    const path = join(root, dir, `${sessionId}.jsonl`);
    if (await stat(path).then((s) => s.isFile(), () => false)) return path;
  }
  return null;
}

async function readFully(handle, start, length) {
  const buffer = Buffer.allocUnsafe(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(buffer, read, length - read, start + read);
    if (bytesRead === 0) break;
    read += bytesRead;
  }
  return buffer.subarray(0, read);
}

function compactedWithPreserved(entry) {
  const meta = entry.compactMetadata;
  return (
    entry.type === "system" &&
    entry.subtype === "compact_boundary" &&
    typeof meta === "object" &&
    meta !== null &&
    ("preservedSegment" in meta || "preservedMessages" in meta)
  );
}

function sourceUuidOf(entry) {
  const attachment = entry.attachment;
  return entry.type === "attachment" &&
    attachment?.type === "queued_command" &&
    typeof attachment.source_uuid === "string" &&
    attachment.source_uuid !== ""
    ? attachment.source_uuid
    : null;
}

function createBackwardReader(handle, end) {
  const read = [];
  const located = new Map();
  let pos = end;
  let carry = Buffer.alloc(0);
  let preserved = false;

  const take = (offset, line) => {
    if (line.length === 0) return;
    if (
      line.length >= REQUEST_RECORD.length &&
      line.subarray(0, REQUEST_RECORD.length).equals(REQUEST_RECORD)
    )
      return;
    let entry;
    try {
      entry = JSON.parse(line.toString("utf8"));
    } catch {
      return;
    }
    if (typeof entry !== "object" || entry === null) return;
    read.push({ offset, entry });
    if (compactedWithPreserved(entry)) preserved = true;
    if (typeof entry.uuid !== "string") return;
    const place = {
      offset,
      parentUuid: entry.parentUuid ?? null,
      spoken:
        (entry.type === "user" || entry.type === "assistant") &&
        !entry.isSidechain,
    };
    located.set(entry.uuid, place);
    const source = sourceUuidOf(entry);
    if (source !== null && !located.has(source)) located.set(source, place);
  };

  return {
    get atStart() {
      return pos === 0;
    },
    get preserved() {
      return preserved;
    },
    located,
    entriesUpTo: (offset) =>
      read
        .filter((r) => r.offset <= offset)
        .reverse()
        .map((r) => r.entry),
    async readChunk() {
      const start = Math.max(0, pos - CHUNK_BYTES);
      const chunk = await readFully(handle, start, pos - start);
      const buffer = carry.length > 0 ? Buffer.concat([chunk, carry]) : chunk;
      let lineEnd = buffer.length;
      for (let i = buffer.length - 1; i >= 0; i--) {
        if (buffer[i] !== 10) continue;
        take(start + i + 1, buffer.subarray(i + 1, lineEnd));
        lineEnd = i;
      }
      carry = Buffer.from(buffer.subarray(0, lineEnd));
      pos = start;
      if (pos === 0) {
        take(0, carry);
        carry = Buffer.alloc(0);
      }
    },
  };
}

function newestSpoken(located) {
  let newest = null;
  for (const [uuid, place] of located) {
    if (place.spoken && (newest === null || place.offset > newest.offset))
      newest = { uuid, offset: place.offset };
  }
  return newest;
}

function chainLength(located, from) {
  let length = 0;
  const seen = new Set();
  let uuid = from;
  while (uuid !== null && located.has(uuid) && !seen.has(uuid)) {
    seen.add(uuid);
    length++;
    uuid = located.get(uuid).parentUuid;
  }
  return { length, rooted: uuid === null };
}

function encodeOlder(place) {
  return `${place.offset}:${place.parentUuid}`;
}

function decodeOlder(cursor) {
  const at = cursor.indexOf(":");
  const offset = Number(cursor.slice(0, at));
  const parentUuid = cursor.slice(at + 1);
  return at > 0 && Number.isInteger(offset) && offset >= 0 && parentUuid
    ? { offset, parentUuid }
    : null;
}

async function messagesOfEntries(sdk, sessionId, entries) {
  return sdk.getSessionMessages(sessionId, {
    sessionStore: { append: async () => {}, load: async () => entries },
  });
}

async function loadWindow(agent, sdk, { sessionId, frames, before }) {
  const cursor = before === undefined ? null : decodeOlder(before);
  const path = await transcriptPath(sessionId);
  if (path === null || (before !== undefined && cursor === null)) return null;
  const handle = await open(path, "r");
  try {
    const end = cursor ? cursor.offset : (await handle.stat()).size;
    const reader = createBackwardReader(handle, end);
    let wanted = frames;
    for (;;) {
      await reader.readChunk();
      if (reader.preserved && cursor === null) return null;
      const parent = cursor && reader.located.get(cursor.parentUuid);
      const leaf = cursor
        ? parent && { uuid: cursor.parentUuid, offset: parent.offset }
        : newestSpoken(reader.located);
      if (!leaf) {
        if (reader.atStart) return { lines: [], older: null };
        continue;
      }
      const { length, rooted } = chainLength(reader.located, leaf.uuid);
      const whole = rooted || reader.atStart;
      if (!whole && length < wanted) continue;
      const messages = await messagesOfEntries(
        sdk,
        sessionId,
        reader.entriesUpTo(cursor ? leaf.offset : end),
      );
      const first = whole ? 0 : messages.findIndex(isPrompt);
      const lines =
        first === -1 ? [] : framesOf(agent, sessionId, messages.slice(first));
      if (!whole && (first === -1 || lines.length < frames)) {
        wanted *= 2;
        continue;
      }
      const place = whole ? undefined : reader.located.get(messages[first].uuid);
      return {
        lines,
        older:
          place !== undefined && place.parentUuid !== null
            ? encodeOlder(place)
            : null,
      };
    }
  } finally {
    await handle.close();
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a Claude Code session's conversation as the
 * runtime replays it, read from the CLI's own transcript without starting the
 * CLI. Given a session id it answers every frame. Given `{ sessionId, frames,
 * before? }` it answers `{ lines, older }`: the newest part of the
 * conversation, or the part before an earlier answer's `older` cursor, of at
 * least `frames` frames and starting at a prompt, so no tool result is parted
 * from its call; `older` is null at the conversation's start. That part is
 * read from the transcript's end, a megabyte at a time, and only as far back
 * as it reaches along the conversation's parent chain, so a cold open of a
 * long session costs the same however long its transcript grew. The request
 * records the CLI writes after each model call are skipped unread, since they
 * hold no conversation and most of a long transcript is them. The SDK turns
 * the entries read into messages exactly as it turns the whole file. A part
 * that reaches a compaction which kept a segment of the conversation from
 * before it falls back to the whole read, since that segment can sit anywhere
 * earlier in the file.
 */
export async function loadHistory(input) {
  const { agent, sdk } = await modulesPromise;
  const windowed = typeof input === "object" && input !== null;
  const sessionId = windowed ? input.sessionId : input;

  const info = await sdk.getSessionInfo(sessionId).catch(() => undefined);
  if (!info) throw new Error(`unknown session ${sessionId}`);

  if (windowed) {
    const window = await loadWindow(agent, sdk, input);
    if (window !== null) return window;
    if (input.before !== undefined) return { lines: [], older: null };
  }

  const lines = framesOf(
    agent,
    sessionId,
    await sdk.getSessionMessages(sessionId),
  );
  return windowed ? { lines, older: null } : lines;
}
