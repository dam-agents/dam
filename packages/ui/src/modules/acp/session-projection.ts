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
 * an assistant bubble carrying its `promptId`; the runtime's
 * `platform_prompt_accepted { queued: true }` marks it queued behind a prior
 * in-flight turn and `platform_prompt_started` promotes it, so the sender's
 * "Waiting for previous prompt…" indicator is server truth rather than a local
 * guess. Bubbles with no `promptId` (another viewer's prompt, replayed history)
 * are still promoted by the first agent content arriving for them. Turn
 * boundaries (`platform_turn_ended`, or a fresh `user_message_chunk`) close the
 * active bubble, so the next agent content picks the earliest remaining queued
 * bubble (or opens one on demand).
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
 *
 * The closing tag must match the opening one by name (backreference). Without
 * that, the lazy body ends at the *first* closing tag of any name, so a
 * wrapper holding a nested element — the harness's
 * `<task-notification><task …>…</task></task-notification>` — matched
 * `<task-notification>…</task>` and left the orphan `</task-notification>`
 * as the whole visible user bubble (issue: stray closing tag in transcript).
 */
const SYSTEM_TAG_RE = /<([a-z-]+)>[\s\S]*?<\/\1>/g;
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

    case "platform_prompt_accepted":
      // `queued: false` means the runtime handed the prompt straight on, which
      // is the bubble's existing (non-queued) shape — nothing to render.
      return update.queued
        ? setQueuedByPromptId(messages, update.promptId, true)
        : messages;

    case "platform_prompt_started":
      return setQueuedByPromptId(messages, update.promptId, false);

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

/**
 * Flip the `queued` flag on the bubble the runtime is reporting about. Only the
 * sender's own optimistic bubble carries a `promptId`, so an unknown id (a
 * notification arriving after the bubble was finalized, or on a reconnected
 * client that rebuilt its list from the log) is a no-op. A bubble that already
 * has content is left alone: content is stronger evidence of "active" than a
 * late `accepted` frame.
 */
function setQueuedByPromptId(
  messages: Message[],
  promptId: string,
  queued: boolean,
): Message[] {
  return messages.map((m) =>
    m.promptId === promptId && m.streaming && m.parts.length === 0
      ? { ...m, queued }
      : m,
  );
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
 * Mark every streaming assistant bubble as no-longer-streaming. Call this at
 * the end of history replay, or when the user stops the agent, to flush bubbles
 * that won't receive any further updates. Queued bubbles are finalized too —
 * they have no content, so the UI just shows an empty closed bubble.
 *
 * Losing the connection is *not* this case: a queued prompt is genuinely lost
 * then, so that path uses `failQueuedOnDisconnect` instead.
 */
export function finalizeAllStreaming(messages: Message[]): Message[] {
  return messages.map(finalizeStreaming);
}

function finalizeStreaming(m: Message): Message {
  return m.role === "assistant" && m.streaming
    ? { ...m, streaming: false, queued: false }
    : m;
}

/** Shown on a prompt the platform dropped because our channel went away. The
 *  only delivery failure the runtime cannot report — by the time it happens
 *  there is no channel left to report it on. */
export const QUEUED_LOST_MESSAGE =
  "Couldn't deliver — the connection dropped while this prompt was still waiting in the queue.";

/**
 * Finalize on connection loss, failing the prompts the loss actually destroyed.
 * The runtime drops a channel's queued prompts when it detaches, so a bubble of
 * ours still parked behind an earlier turn will never be answered: it flips to
 * the error card with Retry rather than closing quietly, which is how this loss
 * used to pass unnoticed. Hidden sends fail silently as everywhere else, so
 * theirs is dropped instead.
 *
 * Only bubbles carrying a `promptId` are ours to fail. Another viewer's queued
 * prompt (or a replayed one) belongs to a channel that is still attached, so it
 * merely finalizes — as does any bubble that already holds content, since
 * content is proof the turn started and content already streamed is not
 * something to retract (the same rule the `queued` flag follows elsewhere here).
 */
export function failQueuedOnDisconnect(messages: Message[]): Message[] {
  return messages.flatMap<Message>((m) => {
    const lost =
      m.role === "assistant" &&
      m.streaming &&
      m.queued &&
      m.promptId !== undefined &&
      m.parts.length === 0;
    if (!lost) return [finalizeStreaming(m)];
    // Hidden sends stash no payload and never surface a failure.
    if (!m.retryWith) return [];
    return [
      {
        ...m,
        streaming: false,
        queued: false,
        error: {
          message: QUEUED_LOST_MESSAGE,
          local: true,
          retryWith: m.retryWith,
        },
      },
    ];
  });
}

/**
 * Rebuild the message list from replayed history while keeping the failure the
 * client raised on its own. The runtime's log is authoritative about what the
 * agent did, but it cannot describe a prompt that never ran: it holds the
 * dropped prompt's user-message echo and no reply, so replacing the list
 * wholesale would erase the failure and its Retry and leave the user staring at
 * a question the agent will never answer.
 *
 * Only the newest such failure is carried, and it lands at the end. Older ones
 * cannot be put back where they belong — a carried bubble's id is client-minted
 * and the replayed log has no counterpart to anchor it to — so appending them
 * would float stale failures below newer replies.
 */
export function mergeLocalFailures(
  rebuilt: Message[],
  previous: Message[],
): Message[] {
  const carried = previous.filter(
    (m) => m.error?.local && !rebuilt.some((r) => r.id === m.id),
  );
  const newest = carried[carried.length - 1];
  return newest ? [...rebuilt, newest] : rebuilt;
}

/** True if any assistant bubble is still streaming (either active or queued). */
export function hasStreamingAssistant(messages: Message[]): boolean {
  return messages.some((m) => m.role === "assistant" && m.streaming);
}

/** True if the agent actually produced something. Verdict parts are minted by
 *  the client when the user answers a permission prompt — they can land on a
 *  bubble the agent never wrote to, so they don't count as agent output. */
export function hasAgentContent(m: Message): boolean {
  return m.parts.some((p) => p.kind !== "verdict");
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
      // Never close an empty sender placeholder. At promotion the runtime
      // sends `promptStarted` (stripping the bubble's queued protection)
      // BEFORE it fans out the previous turn's `platform_turn_ended`, and the
      // sender's own bubble for that turn is already closed by its prompt
      // response — so this boundary would land on the just-promoted, still
      // empty bubble, orphaning it: the reply would then open a fresh bubble.
      // The placeholder's own lifecycle closes it instead: content arriving,
      // its own prompt response, or the delivery deadline.
      if (m.promptId !== undefined && m.parts.length === 0) continue;
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
  // On replay the turn this prompt is parked behind has no bubble yet, so its
  // content would land in this one; `queued` proves that turn existed.
  const parked =
    messages.length > 0 && !hasStreamingAssistant(messages)
      ? [
          ...messages,
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            parts: [],
            streaming: true,
          },
        ]
      : messages;
  return [...parked, userMsg, pending];
}
