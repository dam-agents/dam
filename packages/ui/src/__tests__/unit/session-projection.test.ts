import { describe, expect, test } from "vitest";

import {
  applyUpdate,
  finalizeAllStreaming,
  hasStreamingAssistant,
} from "../../modules/acp/session-projection.js";
import type { Message, ToolChip } from "../../types.js";

// Stable UUIDs would be nice; Node >= 18 has globalThis.crypto.randomUUID —
// vitest's environment: "node" picks it up. Each call generates a new id for
// on-demand bubbles, so assertions focus on shape rather than id equality.

function userMsg(id: string, text: string): Message {
  return {
    id,
    role: "user",
    parts: [{ kind: "text", text }],
    streaming: false,
  };
}

function assistantMsg(
  id: string,
  text: string,
  streaming = false,
  queued?: boolean,
): Message {
  return {
    id,
    role: "assistant",
    parts: text ? [{ kind: "text", text }] : [],
    streaming,
    ...(queued !== undefined ? { queued } : {}),
  };
}

const txtChunk = (
  text: string,
  kind: "agent_message_chunk" | "user_message_chunk" = "agent_message_chunk",
) => ({
  sessionUpdate: kind,
  content: { type: "text" as const, text },
});

/** Pull the leading text part's body out of a message. Throws when the first
 *  part isn't text — these tests build messages with a known shape, so a
 *  mismatch should fail loudly rather than silently return "". */
function firstTextPart({ parts }: Message): string {
  const [first] = parts;
  if (first?.kind !== "text")
    throw new Error(`expected text part, got ${first?.kind ?? "none"}`);
  return first.text;
}

describe("applyUpdate — agent content", () => {
  test("opens a new assistant bubble on demand when no bubble exists", () => {
    const out = applyUpdate([], txtChunk("hello"));
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("assistant");
    expect(out[0].streaming).toBe(true);
    expect(out[0].parts).toEqual([{ kind: "text", text: "hello" }]);
  });

  test("appends to the active (streaming, non-queued) assistant", () => {
    const start: Message[] = [
      userMsg("u1", "hi"),
      assistantMsg("a1", "he", true),
    ];
    const out = applyUpdate(start, txtChunk("llo"));
    expect(out).toHaveLength(2);
    expect(out[1].parts).toEqual([{ kind: "text", text: "hello" }]);
  });

  test("promotes the earliest queued bubble when no active exists", () => {
    const start: Message[] = [
      userMsg("u1", "q"),
      assistantMsg("a1", "", true, true),
    ];
    const out = applyUpdate(start, txtChunk("answer"));
    expect(out[1].queued).toBe(false);
    expect(out[1].parts).toEqual([{ kind: "text", text: "answer" }]);
  });

  test("does not promote queued bubble if an active one is present", () => {
    // Prompt 1 still streaming (a1 active); prompt 2 already appended (a2
    // queued) while we await a1's response. Agent content for prompt 1 must
    // continue landing in a1 even though a2 sits after the last user message.
    const start: Message[] = [
      userMsg("u1", "first"),
      assistantMsg("a1", "streaming", true, false),
      userMsg("u2", "second"),
      assistantMsg("a2", "", true, true),
    ];
    const out = applyUpdate(start, txtChunk(" more"));
    expect(out[1].parts).toEqual([{ kind: "text", text: "streaming more" }]);
    expect(out[3].queued).toBe(true);
    expect(out[3].parts).toEqual([]);
  });

  test("merges consecutive agent text chunks into one run", () => {
    let messages: Message[] = [];
    messages = applyUpdate(messages, txtChunk("hel"));
    messages = applyUpdate(messages, txtChunk("lo "));
    messages = applyUpdate(messages, txtChunk("world"));
    expect(messages).toHaveLength(1);
    expect(messages[0].parts).toEqual([{ kind: "text", text: "hello world" }]);
  });

  test("appends image as a new part after text", () => {
    let messages: Message[] = [];
    messages = applyUpdate(messages, txtChunk("see:"));
    messages = applyUpdate(messages, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "image", data: "AAAA", mimeType: "image/png" },
    });
    expect(messages[0].parts).toEqual([
      { kind: "text", text: "see:" },
      { kind: "image", data: "AAAA", mimeType: "image/png" },
    ]);
  });

  test("agent_thought_chunk produces a thought part distinct from text", () => {
    const out = applyUpdate([], {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thinking" },
    });
    expect(out[0].role).toBe("assistant");
    expect(out[0].parts).toEqual([{ kind: "thought", text: "thinking" }]);
  });

  test("consecutive thought chunks merge into one part", () => {
    let messages: Message[] = [];
    messages = applyUpdate(messages, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "rea" },
    });
    messages = applyUpdate(messages, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "soning" },
    });
    expect(messages[0].parts).toEqual([{ kind: "thought", text: "reasoning" }]);
  });

  test("thought followed by message yields two parts in order", () => {
    let messages: Message[] = [];
    messages = applyUpdate(messages, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "let me think" },
    });
    messages = applyUpdate(messages, txtChunk("the answer"));
    expect(messages[0].parts).toEqual([
      { kind: "thought", text: "let me think" },
      { kind: "text", text: "the answer" },
    ]);
  });

  test("message followed by thought yields two parts and does not merge", () => {
    let messages: Message[] = [];
    messages = applyUpdate(messages, txtChunk("hi"));
    messages = applyUpdate(messages, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "wait" },
    });
    expect(messages[0].parts).toEqual([
      { kind: "text", text: "hi" },
      { kind: "thought", text: "wait" },
    ]);
  });
});

describe("applyUpdate — turn boundaries", () => {
  test("platform_turn_ended closes the active assistant", () => {
    const start: Message[] = [
      userMsg("u1", "hi"),
      assistantMsg("a1", "hello", true),
    ];
    const out = applyUpdate(start, { sessionUpdate: "platform_turn_ended" });
    expect(out[1].streaming).toBe(false);
  });

  test("platform_turn_ended closes the active bubble and leaves queued ones alone", () => {
    const start: Message[] = [
      userMsg("u1", "first"),
      assistantMsg("a1", "hello", true, false),
      userMsg("u2", "second"),
      assistantMsg("a2", "", true, true),
    ];
    const out = applyUpdate(start, { sessionUpdate: "platform_turn_ended" });
    expect(out[1].streaming).toBe(false);
    expect(out[3].streaming).toBe(true);
    expect(out[3].queued).toBe(true);
  });

  test("platform_turn_ended skips queued-only states (no active to close)", () => {
    const start: Message[] = [
      userMsg("u1", "first"),
      assistantMsg("a1", "", true, true),
    ];
    const out = applyUpdate(start, { sessionUpdate: "platform_turn_ended" });
    expect(out).toEqual(start);
  });

  test("platform_turn_ended on empty state is a no-op", () => {
    const out = applyUpdate([], { sessionUpdate: "platform_turn_ended" });
    expect(out).toEqual([]);
  });

  test("user_message_chunk closes the previous assistant and opens a user message", () => {
    const start: Message[] = [
      userMsg("u1", "hi"),
      assistantMsg("a1", "hello", true),
    ];
    const out = applyUpdate(start, {
      ...txtChunk("bye", "user_message_chunk"),
      messageId: "u2",
    });
    expect(out).toHaveLength(3);
    expect(out[1].streaming).toBe(false);
    expect(out[2]).toMatchObject({ id: "u2", role: "user" });
  });

  test("user_message_chunk with existing messageId merges text", () => {
    const start: Message[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ kind: "text", text: "hel" }],
        streaming: false,
      },
    ];
    const out = applyUpdate(start, {
      ...txtChunk("lo", "user_message_chunk"),
      messageId: "u1",
    });
    expect(out).toHaveLength(1);
    expect(out[0].parts).toEqual([{ kind: "text", text: "hello" }]);
  });

  test("user_message_chunk strips <context> tags and extracts file chip", () => {
    const start: Message[] = [];
    const update = {
      sessionUpdate: "user_message_chunk" as const,
      messageId: "u1",
      content: {
        type: "text" as const,
        text: 'see <context ref="file:///notes.md">big body</context> please',
      },
    };
    const out = applyUpdate(start, update);
    expect(out).toHaveLength(1);
    expect(out[0].parts).toEqual([
      { kind: "text", text: "see" },
      { kind: "file", name: "notes.md", mimeType: "" },
      { kind: "text", text: "please" },
    ]);
  });

  test("user_message_chunk extracts binary file reference as file chip", () => {
    const out = applyUpdate([], {
      sessionUpdate: "user_message_chunk" as const,
      messageId: "u1",
      content: {
        type: "text" as const,
        text: "look at [@image.png](file:///tmp/image.png)",
      },
    });
    expect(out[0].parts).toEqual([
      { kind: "text", text: "look at" },
      { kind: "file", name: "image.png", mimeType: "" },
    ]);
  });
});

describe("applyUpdate — tool calls", () => {
  test("tool_call appends a chip to the active assistant", () => {
    const start: Message[] = [
      userMsg("u1", "run it"),
      assistantMsg("a1", "", true),
    ];
    const out = applyUpdate(start, {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Bash",
      status: "pending",
    });
    const chip = out[1].parts[0] as ToolChip;
    expect(chip.kind).toBe("tool");
    expect(chip.toolCallId).toBe("t1");
    expect(chip.title).toBe("Bash");
    expect(chip.status).toBe("pending");
  });

  test("tool_call dedupes by toolCallId (update in place)", () => {
    const start: Message[] = [
      userMsg("u1", "hi"),
      {
        id: "a1",
        role: "assistant",
        parts: [
          { kind: "tool", toolCallId: "t1", title: "Bash", status: "pending" },
        ],
        streaming: true,
      },
    ];
    const out = applyUpdate(start, {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Bash",
      status: "in_progress",
    });
    expect(out[1].parts).toHaveLength(1);
    expect((out[1].parts[0] as ToolChip).status).toBe("in_progress");
  });

  test("tool_call_update updates the matching chip across any message", () => {
    const start: Message[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          { kind: "tool", toolCallId: "t1", title: "Bash", status: "pending" },
        ],
        streaming: false,
      },
      userMsg("u2", "continue"),
      assistantMsg("a2", "", true),
    ];
    const out = applyUpdate(start, {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
    });
    expect((out[0].parts[0] as ToolChip).status).toBe("completed");
    expect(out[2].parts).toHaveLength(0);
  });

  test("tool_call_update for unknown chip is a no-op", () => {
    const start: Message[] = [
      userMsg("u1", "hi"),
      assistantMsg("a1", "hello", false),
    ];
    const out = applyUpdate(start, {
      sessionUpdate: "tool_call_update",
      toolCallId: "missing",
      status: "completed",
    });
    expect(out).toEqual(start);
  });
});

describe("replay scenarios", () => {
  test("classic multi-turn replay: user, agent, user, agent", () => {
    let m: Message[] = [];
    m = applyUpdate(m, {
      ...txtChunk("q1", "user_message_chunk"),
      messageId: "u1",
    });
    m = applyUpdate(m, txtChunk("a1", "agent_message_chunk"));
    m = applyUpdate(m, {
      ...txtChunk("q2", "user_message_chunk"),
      messageId: "u2",
    });
    m = applyUpdate(m, txtChunk("a2", "agent_message_chunk"));
    m = finalizeAllStreaming(m);

    expect(
      m.map((message) => ({
        role: message.role,
        text: firstTextPart(message),
        streaming: message.streaming,
      })),
    ).toEqual([
      { role: "user", text: "q1", streaming: false },
      { role: "assistant", text: "a1", streaming: false },
      { role: "user", text: "q2", streaming: false },
      { role: "assistant", text: "a2", streaming: false },
    ]);
  });

  test("tool chip is grouped under the assistant bubble, not a second one", () => {
    let m: Message[] = [];
    m = applyUpdate(m, {
      ...txtChunk("run ls", "user_message_chunk"),
      messageId: "u1",
    });
    m = applyUpdate(m, txtChunk("sure", "agent_message_chunk"));
    m = applyUpdate(m, {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "ls",
      status: "completed",
    });
    m = applyUpdate(m, txtChunk("done", "agent_message_chunk"));
    m = finalizeAllStreaming(m);

    expect(m).toHaveLength(2);
    expect(m[1].role).toBe("assistant");
    expect(m[1].parts.map((p) => p.kind)).toEqual(["text", "tool", "text"]);
  });
});

describe("queued prompt scenarios", () => {
  test("second prompt queues behind the first; content lands on the right bubble after turn end", () => {
    // Initial: first prompt in flight, second prompt queued.
    let m: Message[] = [
      userMsg("u1", "first"),
      assistantMsg("a1", "", true, false),
      userMsg("u2", "second"),
      assistantMsg("a2", "", true, true),
    ];

    // Agent streams response to first prompt.
    m = applyUpdate(m, txtChunk("hello 1"));
    expect(firstTextPart(m[1])).toBe("hello 1");
    expect(m[1].queued ?? false).toBe(false);
    expect(m[3].parts).toEqual([]);
    expect(m[3].queued).toBe(true);

    // Turn 1 ends.
    m = applyUpdate(m, { sessionUpdate: "platform_turn_ended" });
    expect(m[1].streaming).toBe(false);
    expect(m[3].streaming).toBe(true);

    // Agent starts streaming second prompt — promotes a2 to active.
    m = applyUpdate(m, txtChunk("hello 2"));
    expect(m[3].queued).toBe(false);
    expect(firstTextPart(m[3])).toBe("hello 2");

    // Turn 2 ends.
    m = applyUpdate(m, { sessionUpdate: "platform_turn_ended" });
    expect(m[3].streaming).toBe(false);
  });
});

describe("finalizeAllStreaming + hasStreamingAssistant", () => {
  test("finalizeAllStreaming closes every streaming assistant and drops queued flag", () => {
    const start: Message[] = [
      assistantMsg("a1", "x", true, false),
      assistantMsg("a2", "", true, true),
      assistantMsg("a3", "done", false, false),
    ];
    const out = finalizeAllStreaming(start);
    expect(out.every((m) => !m.streaming)).toBe(true);
    expect(out[1].queued).toBe(false);
  });

  test("hasStreamingAssistant detects both active and queued bubbles", () => {
    expect(hasStreamingAssistant([])).toBe(false);
    expect(hasStreamingAssistant([userMsg("u1", "x")])).toBe(false);
    expect(hasStreamingAssistant([assistantMsg("a1", "x", false)])).toBe(false);
    expect(hasStreamingAssistant([assistantMsg("a1", "x", true)])).toBe(true);
    expect(hasStreamingAssistant([assistantMsg("a1", "", true, true)])).toBe(
      true,
    );
  });
});
