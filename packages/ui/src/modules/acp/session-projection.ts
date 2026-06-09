import type {
  ContentChunk,
  ToolCall,
  ToolCallContent,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk/dist/schema/types.gen.js";

import type {
  Message,
  MessagePart,
  ToolChip,
  ToolContent,
} from "../../types.js";
import type { AcpUpdate } from "./types.js";

/**
 * Unified session projection — applies ACP `sessionUpdate` notifications (and
 * our synthetic `platform_turn_ended`) to a message list. Pure: no DOM, no refs,
 * no side effects. Used by both live streaming and history replay so the two
 * paths can't drift.
 *
 * Routing model: updates flow into the "active" assistant bubble — the last
 * streaming, non-queued assistant after the last user. `sendPrompt` appends
 * an assistant bubble with `queued: true` while a prior turn is in flight;
 * the first agent content arriving for that prompt promotes the queued
 * bubble to active. Turn boundaries (`platform_turn_ended`, or a fresh
 * `user_message_chunk`) close the active bubble, so the next agent content
 * picks the earliest remaining queued bubble (or opens one on demand).
 *
 * Queued background prompts: a `user_message_chunk` carrying
 * `_meta.queued === true` is a prompt the runtime parked behind the active
 * turn (a self-scheduled wakeup, a trigger, or a second viewer's prompt that
 * arrived mid-stream). It is NOT a turn boundary — the active reply is still
 * streaming — so it must not close the active bubble. We append the user
 * message plus a queued (pending) assistant bubble, mirroring `sendPrompt`'s
 * optimistic shape, and let the active reply keep merging. When the active
 * turn finally ends and the agent starts the parked turn, the pending bubble
 * is promoted on its first content. Without the marker, a mid-stream
 * `user_message_chunk` would split the live reply across two bubbles and slot
 * the parked prompt between them (issue #703).
 */

/**
 * Strip system tags like `<context>...</context>` that wrap replayed
 * attachments in user messages. Also trims leading/trailing whitespace —
 * user messages are whole, not streamed, so trimming is safe. Do NOT apply
 * to agent chunks: those arrive piece by piece and trimming would collapse
 * inter-chunk spaces into `"helloworld"`.
 */
const SYSTEM_TAG_RE = /(<[a-z-]+>)([\s\S]*?)(<\/[a-z-]+>)/g;
function stripUserTags(raw: string): string {
  let result = raw;
  let prev;
  do {
    prev = result;
    result = result.replace(SYSTEM_TAG_RE, "");
  } while (result !== prev);
  return result.trim();
}

function mapToolContent(
  content: ToolCallContent[] | undefined | null,
): ToolContent[] | undefined {
  return content
    ?.map<ToolContent>((c) => {
      if (c.type === "content")
        return {
          type: c.type,
          text: c.content.type === "text" ? c.content.text : "",
        };
      return { type: c.type, text: "" };
    })
    .filter((c) => c.text);
}

/**
 * Parse a replayed user message into chip + text parts.
 *
 * The Claude SDK round-trips uploaded attachments back as text:
 *   - text files become `<context ref="file:///NAME">FULL_BODY</context>`
 *   - binary files become `[@NAME](file:///PATH)`
 *
 * Both should render as a file chip — we don't want to dump the whole file
 * body into the user bubble.
 */
function parseUserText(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const regex =
    /<context\s+ref="file:\/\/\/([^"]+)">[\s\S]*?<\/context>|\[@([^\]]+)\]\(file:\/\/\/([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      const seg = text.slice(last, m.index).trim();
      if (seg) parts.push({ kind: "text", text: seg });
    }
    const name = m[1] ?? m[2] ?? m[3];
    parts.push({ kind: "file", name, mimeType: "" });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    const seg = text.slice(last).trim();
    if (seg) parts.push({ kind: "text", text: seg });
  }
  return parts.length > 0 ? parts : [{ kind: "text", text }];
}

export function applyUpdate(messages: Message[], update: AcpUpdate): Message[] {
  switch (update.sessionUpdate) {
    case "platform_turn_ended":
      return closeActiveAssistant(messages);

    case "platform_clipped_replay":
      return appendNotice(messages, "Older conversation not loaded");

    case "user_message_chunk":
      return handleUserChunk(messages, update);

    case "agent_message_chunk":
      return handleAgentChunk(messages, update, "text");

    case "agent_thought_chunk":
      return handleAgentChunk(messages, update, "thought");

    case "tool_call":
      return handleToolCall(messages, update);

    case "tool_call_update":
      return handleToolCallUpdate(messages, update);

    default:
      return messages;
  }
}

function appendNotice(messages: Message[], text: string): Message[] {
  return [
    ...messages,
    {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [{ kind: "text", text }],
      streaming: false,
      notice: true,
    },
  ];
}

/**
 * Mark every streaming assistant bubble as no-longer-streaming. Call this on
 * WebSocket disconnect or at the end of history replay to flush bubbles that
 * won't receive any further updates. Queued bubbles are finalized too — they
 * have no content, so the UI just shows an empty closed bubble.
 */
export function finalizeAllStreaming(messages: Message[]): Message[] {
  return messages.map((m) =>
    m.role === "assistant" && m.streaming
      ? { ...m, streaming: false, queued: false }
      : m,
  );
}

/** True if any assistant bubble is still streaming (either active or queued). */
export function hasStreamingAssistant(messages: Message[]): boolean {
  return messages.some((m) => m.role === "assistant" && m.streaming);
}

function handleUserChunk(messages: Message[], u: ContentChunk): Message[] {
  const queued = u._meta?.queued === true;
  const mid = u.messageId ?? null;

  let parts: MessagePart[] | null = null;
  if (u.content.type === "text") {
    const txt = stripUserTags(u.content.text);
    if (txt) parts = parseUserText(txt);
  } else if (u.content.type === "image") {
    parts = [
      { kind: "image", data: u.content.data, mimeType: u.content.mimeType },
    ];
  }

  // Nothing renderable: a real turn boundary still closes the active bubble; a
  // queued background prompt must leave the live reply untouched.
  if (parts === null) return queued ? messages : closeActiveAssistant(messages);

  if (queued) return appendQueuedUser(messages, mid, parts);

  return appendOrExtendUser(closeActiveAssistant(messages), mid, parts);
}

function handleAgentChunk(
  messages: Message[],
  u: ContentChunk,
  kind: "text" | "thought",
): Message[] {
  if (u.content.type === "text") {
    const txt = u.content.text;
    if (!txt) return messages;
    return appendToActive(messages, [{ kind, text: txt }]);
  }
  if (u.content.type === "image") {
    return appendToActive(messages, [
      { kind: "image", data: u.content.data, mimeType: u.content.mimeType },
    ]);
  }
  return messages;
}

function handleToolCall(messages: Message[], u: ToolCall): Message[] {
  const existingIdx = findToolIdx(messages, u.toolCallId);
  if (existingIdx !== null) return patchToolChip(messages, existingIdx, u);
  const chip: ToolChip = {
    kind: "tool",
    toolCallId: u.toolCallId,
    title: u.title,
    status: u.status ?? "pending",
    content: mapToolContent(u.content),
  };
  return appendToActive(messages, [chip]);
}

function handleToolCallUpdate(
  messages: Message[],
  u: ToolCallUpdate,
): Message[] {
  const existingIdx = findToolIdx(messages, u.toolCallId);
  if (existingIdx === null) return messages;
  return patchToolChip(messages, existingIdx, u);
}

function findToolIdx(
  messages: Message[],
  toolCallId: string | undefined,
): number | null {
  if (!toolCallId) return null;
  for (let i = 0; i < messages.length; i++) {
    if (
      messages[i].parts.some(
        (p) => p.kind === "tool" && p.toolCallId === toolCallId,
      )
    )
      return i;
  }
  return null;
}

function patchToolChip(
  messages: Message[],
  idx: number,
  u: ToolCall | ToolCallUpdate,
): Message[] {
  const content = mapToolContent(u.content);
  return messages.map((m, i) =>
    i !== idx
      ? m
      : {
          ...m,
          parts: m.parts.map((p) =>
            p.kind === "tool" && p.toolCallId === u.toolCallId
              ? {
                  ...p,
                  status: u.status ?? p.status,
                  title: u.title ?? p.title,
                  content: content?.length ? content : p.content,
                }
              : p,
          ),
        },
  );
}

interface ActiveTarget {
  idx: number;
  /** True if we're promoting a queued bubble to active (first content arrival). */
  promote: boolean;
}

function findActiveAssistant(messages: Message[]): ActiveTarget | null {
  // There is at most one active assistant (streaming && !queued) at a time:
  //   - sendPrompt marks new bubbles `queued: true` whenever one is already
  //     streaming
  //   - closeActiveAssistant flips the current active to streaming=false
  //     before any queued bubble is promoted
  // So the search is "first streaming, non-queued" with no need to anchor on
  // user messages. Anchoring by "last user" breaks the moment sendPrompt
  // appends a second `(user, queued assistant)` pair while the previous
  // assistant is still streaming.
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "assistant" && m.streaming && !m.queued)
      return { idx: i, promote: false };
  }
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "assistant" && m.streaming && m.queued)
      return { idx: i, promote: true };
  }
  return null;
}

function appendToActive(
  messages: Message[],
  newParts: MessagePart[],
): Message[] {
  const target = findActiveAssistant(messages);
  if (target === null) {
    const newMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: mergeParts([], newParts),
      streaming: true,
    };
    return [...messages, newMsg];
  }
  return messages.map((m, i) => {
    if (i !== target.idx) return m;
    return {
      ...m,
      parts: mergeParts(m.parts, newParts),
      streaming: true,
      queued: target.promote ? false : m.queued,
    };
  });
}

function mergeParts(
  existing: MessagePart[],
  incoming: MessagePart[],
): MessagePart[] {
  const merged = [...existing];
  for (const p of incoming) {
    const last = merged[merged.length - 1];
    if (p.kind === "text" && last?.kind === "text") {
      merged[merged.length - 1] = { kind: "text", text: last.text + p.text };
    } else if (p.kind === "thought" && last?.kind === "thought") {
      merged[merged.length - 1] = { kind: "thought", text: last.text + p.text };
    } else {
      merged.push(p);
    }
  }
  return merged;
}

function closeActiveAssistant(messages: Message[]): Message[] {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "assistant" && m.streaming && !m.queued) {
      return messages.map((x, j) => (j === i ? { ...x, streaming: false } : x));
    }
  }
  return messages;
}

function appendOrExtendUser(
  messages: Message[],
  mid: string | null,
  parts: MessagePart[],
): Message[] {
  if (mid) {
    const idx = messages.findIndex((m) => m.id === mid);
    if (idx !== -1) {
      return messages.map((m, i) =>
        i !== idx ? m : { ...m, parts: mergeParts(m.parts, parts) },
      );
    }
  }
  const newMsg: Message = {
    id: mid ?? crypto.randomUUID(),
    role: "user",
    parts,
    streaming: false,
  };
  return [...messages, newMsg];
}

/**
 * Append a queued background prompt without disturbing the active reply: a
 * user bubble followed by a `queued` assistant placeholder (the same shape
 * `sendPrompt` writes for a locally-queued prompt). The placeholder is
 * promoted to active once the parked turn starts streaming.
 *
 * Consecutive chunks of the same multi-block prompt arrive back-to-back with
 * no agent content between them; we fold those into the user bubble that sits
 * just before the trailing placeholder instead of stacking a new pair.
 */
function appendQueuedUser(
  messages: Message[],
  mid: string | null,
  parts: MessagePart[],
): Message[] {
  const n = messages.length;
  const tailAssistant = messages[n - 1];
  const tailUser = messages[n - 2];
  if (
    tailAssistant?.role === "assistant" &&
    tailAssistant.queued &&
    tailAssistant.parts.length === 0 &&
    tailUser?.role === "user"
  ) {
    return messages.map((m, i) =>
      i === n - 2 ? { ...m, parts: mergeParts(m.parts, parts) } : m,
    );
  }
  const userMsg: Message = {
    id: mid ?? crypto.randomUUID(),
    role: "user",
    parts,
    streaming: false,
  };
  const pending: Message = {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [],
    streaming: true,
    queued: true,
  };
  return [...messages, userMsg, pending];
}
