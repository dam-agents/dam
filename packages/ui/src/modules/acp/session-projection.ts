import type {
  ContentChunk,
  ToolCall,
  ToolCallContent,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import type { PlatformUndeliveredPrompt } from "api-server-api";

import type {
  Message,
  MessagePart,
  ToolChip,
  ToolContent,
} from "../../types.js";
import type { AcpUpdate } from "./types.js";

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
      return update.queued
        ? setQueuedByPromptId(messages, update.promptId, true)
        : messages;

    case "platform_prompt_started":
      return setQueuedByPromptId(messages, update.promptId, false);

    case "platform_clipped_replay":
      return appendClippedMarker(messages, update.older);

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

function appendClippedMarker(
  messages: Message[],
  older: string | undefined,
): Message[] {
  if (older === undefined) {
    return appendNotice(messages, "Older conversation not loaded");
  }
  return [
    ...messages,
    {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [{ kind: "text", text: "Older messages not shown" }],
      streaming: false,
      notice: true,
      loadOlderBefore: older,
    },
  ];
}

export function finalizeAllStreaming(messages: Message[]): Message[] {
  return messages.map(finalizeStreaming);
}

export const UNDELIVERED_MESSAGE =
  "Not delivered — this never reached the agent.";

function textOf(record: PlatformUndeliveredPrompt): string {
  return record.blocks
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n\n");
}

function partsOf(record: PlatformUndeliveredPrompt): MessagePart[] {
  const parts: MessagePart[] = [];
  for (const block of record.blocks) {
    if (block.type === "image")
      parts.push({
        kind: "image",
        data: block.data,
        mimeType: block.mimeType,
      });
    else if (block.type === "resource_link")
      parts.push({
        kind: "file",
        name: block.name,
        mimeType: block.mimeType ?? "",
      });
  }
  const text = textOf(record);
  if (text) parts.push({ kind: "text", text });
  return parts.length > 0 ? parts : [{ kind: "text", text: "" }];
}

function undeliveredError(record: PlatformUndeliveredPrompt): Message["error"] {
  const reason = record.reason ?? UNDELIVERED_MESSAGE;
  const lost = record.droppedAttachments;
  return {
    message:
      lost.length === 0
        ? reason
        : `${reason} Sending it again will not include ${lost.join(", ")} — attach again to send ${lost.length === 1 ? "it" : "them"} too.`,
    retryWith: {
      text: textOf(record),
      ...(record.blocks.length > 0 ? { blocks: record.blocks } : {}),
    },
  };
}

function undeliveredBubble(record: PlatformUndeliveredPrompt): Message {
  return {
    id: record.id,
    role: "user",
    parts: partsOf(record),
    streaming: false,
    error: undeliveredError(record),
  };
}

function markUndelivered(
  messages: Message[],
  records: Map<string, PlatformUndeliveredPrompt>,
): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const record = m.role === "user" ? records.get(m.id) : undefined;
    if (record === undefined) {
      out.push(m);
      continue;
    }
    out.push(m.error ? m : { ...m, error: undeliveredError(record) });
    const next = messages[i + 1];
    if (next?.role === "assistant" && next.queued && next.parts.length === 0)
      i += 1;
  }
  return out;
}

export function appendUndelivered(
  messages: Message[],
  records: PlatformUndeliveredPrompt[],
): Message[] {
  if (records.length === 0) return messages;
  const marked = markUndelivered(
    messages,
    new Map(records.map((r) => [r.id, r])),
  );
  const fresh = records
    .filter((r) => !messages.some((m) => m.id === r.id))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  if (fresh.length === 0) return marked;
  return [...marked, ...fresh.map(undeliveredBubble)];
}

export function settleReplay(
  messages: Message[],
  { turnInFlight }: { turnInFlight: boolean },
): Message[] {
  return turnInFlight ? messages : finalizeAllStreaming(messages);
}

function finalizeStreaming(m: Message): Message {
  return m.role === "assistant" && m.streaming
    ? { ...m, streaming: false, queued: false }
    : m;
}

export function failQueuedOnDisconnect(messages: Message[]): Message[] {
  return messages.flatMap<Message>((m) => {
    const ourEmptyQueued =
      m.role === "assistant" &&
      m.streaming &&
      m.queued &&
      m.promptId !== undefined &&
      m.parts.length === 0;
    if (ourEmptyQueued && !m.retryWith) return [];
    return [finalizeStreaming(m)];
  });
}

export function mergeLocalFailures(
  rebuilt: Message[],
  previous: Message[],
): Message[] {
  const carried = previous.filter(
    (m) => m.error?.retryWith && !rebuilt.some((r) => r.id === m.id),
  );
  return carried.length === 0 ? rebuilt : [...rebuilt, ...carried];
}

export function hasStreamingAssistant(messages: Message[]): boolean {
  return messages.some((m) => m.role === "assistant" && m.streaming);
}

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
  promote: boolean;
}

function findActiveAssistant(messages: Message[]): ActiveTarget | null {
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
    tailUser?.role === "user" &&
    (mid === null || tailUser.id === mid)
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
