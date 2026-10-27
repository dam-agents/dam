import { describe, expect, test } from "vitest";

import {
  appendInterruptedNotice,
  appendQueuedSends,
  applyUpdate,
  failQueuedOnDisconnect,
  finalizeAllStreaming,
  hasStreamingAssistant,
  mergeLocalFailures,
} from "../../modules/acp/session-projection.js";
import type { Message, ToolChip } from "../../types.js";

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
    const out = applyUpdate(start, {
      sessionUpdate: "platform_turn_ended",
      sessionId: "test-sid",
    });
    expect(out[1].streaming).toBe(false);
  });

  test("platform_turn_ended closes the active bubble and leaves queued ones alone", () => {
    const start: Message[] = [
      userMsg("u1", "first"),
      assistantMsg("a1", "hello", true, false),
      userMsg("u2", "second"),
      assistantMsg("a2", "", true, true),
    ];
    const out = applyUpdate(start, {
      sessionUpdate: "platform_turn_ended",
      sessionId: "test-sid",
    });
    expect(out[1].streaming).toBe(false);
    expect(out[3].streaming).toBe(true);
    expect(out[3].queued).toBe(true);
  });

  test("platform_turn_ended skips queued-only states (no active to close)", () => {
    const start: Message[] = [
      userMsg("u1", "first"),
      assistantMsg("a1", "", true, true),
    ];
    const out = applyUpdate(start, {
      sessionUpdate: "platform_turn_ended",
      sessionId: "test-sid",
    });
    expect(out).toEqual(start);
  });

  test("platform_turn_ended on empty state is a no-op", () => {
    const out = applyUpdate([], {
      sessionUpdate: "platform_turn_ended",
      sessionId: "test-sid",
    });
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

  test("a system wrapper holding a nested element leaves no orphan closing tag", () => {
    const out = applyUpdate([], {
      sessionUpdate: "user_message_chunk" as const,
      messageId: "u1",
      content: {
        type: "text" as const,
        text: '<task-notification>\n<task id="ab12" status="completed">\ndiag run finished\n</task>\n</task-notification>',
      },
    });
    expect(out).toEqual([]);
  });

  test("a system wrapper with nested elements still closes the active bubble", () => {
    const start: Message[] = [
      userMsg("u1", "go"),
      assistantMsg("a1", "working", true),
    ];
    const out = applyUpdate(start, {
      sessionUpdate: "user_message_chunk" as const,
      messageId: "u2",
      content: {
        type: "text" as const,
        text: "<system-reminder>\n<note>heads up</note>\n</system-reminder>",
      },
    });
    expect(out).toHaveLength(2);
    expect(out[1].streaming).toBe(false);
  });

  test("each message steered into a running turn shows as its own user message", () => {
    const start: Message[] = [
      userMsg("u1", "go"),
      assistantMsg("a1", "working", true),
    ];
    const out = applyUpdate(start, {
      sessionUpdate: "user_message_chunk" as const,
      messageId: "u2",
      content: {
        type: "text" as const,
        text: [
          "<new-messages>",
          "2 more messages arrived in this conversation while you were working.",
          "Several messages now share this turn, so pass the [ts …] tag.",
          "[ts 1.1] <@U1>: first",
          "second line",
          "[ts 1.2] <@U2>: third",
          "</new-messages>",
        ].join("\n"),
      },
    });
    expect(out).toHaveLength(4);
    expect(out[1].streaming).toBe(false);
    expect(out.slice(2).map((m) => [m.role, m.parts])).toEqual([
      ["user", [{ kind: "text", text: "[ts 1.1] <@U1>: first\nsecond line" }]],
      ["user", [{ kind: "text", text: "[ts 1.2] <@U2>: third" }]],
    ]);
  });

  test("replayed channel history shows as a history part, the frame does not", () => {
    const out = applyUpdate([], {
      sessionUpdate: "user_message_chunk" as const,
      messageId: "u1",
      content: {
        type: "text" as const,
        text: [
          "<how-to-respond>\nreply with the tool\n</how-to-respond>",
          "<context>\nThe history below is the thread.\n\n[Mon] alice: hi\n</context>",
          "what now?",
        ].join("\n\n"),
      },
    });
    expect(out[0].parts).toEqual([
      {
        kind: "history",
        text: "The history below is the thread.\n\n[Mon] alice: hi",
      },
      { kind: "text", text: "what now?" },
    ]);
  });

  // TEST_SCENARIO: Claude Code delivers a subagent's report as a prompt of its own, wrapped in `<agent-message from="…">`. It is plumbing like a task notification, and the tag names an attribute, so neither the report nor the wrapper shows under the owner's name.
  test("a subagent hand-back with an attribute is hidden as plumbing", () => {
    const out = applyUpdate([], {
      sessionUpdate: "user_message_chunk" as const,
      messageId: "u1",
      content: {
        type: "text" as const,
        text: [
          '<agent-message from="agent-7">\nfound three issues\n</agent-message>',
          "carry on",
        ].join("\n\n"),
      },
    });
    expect(out[0].parts).toEqual([{ kind: "text", text: "carry on" }]);
  });

  test("a lowercase tag that is not platform plumbing stays visible", () => {
    const out = applyUpdate([], {
      sessionUpdate: "user_message_chunk" as const,
      messageId: "u1",
      content: { type: "text" as const, text: "wrap it in <b-tag>x</b-tag>" },
    });
    expect(out[0].parts).toEqual([
      { kind: "text", text: "wrap it in <b-tag>x</b-tag>" },
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
    let m: Message[] = [
      userMsg("u1", "first"),
      assistantMsg("a1", "", true, false),
      userMsg("u2", "second"),
      assistantMsg("a2", "", true, true),
    ];

    m = applyUpdate(m, txtChunk("hello 1"));
    expect(firstTextPart(m[1])).toBe("hello 1");
    expect(m[1].queued ?? false).toBe(false);
    expect(m[3].parts).toEqual([]);
    expect(m[3].queued).toBe(true);

    m = applyUpdate(m, {
      sessionUpdate: "platform_turn_ended",
      sessionId: "test-sid",
    });
    expect(m[1].streaming).toBe(false);
    expect(m[3].streaming).toBe(true);

    m = applyUpdate(m, txtChunk("hello 2"));
    expect(m[3].queued).toBe(false);
    expect(firstTextPart(m[3])).toBe("hello 2");

    m = applyUpdate(m, {
      sessionUpdate: "platform_turn_ended",
      sessionId: "test-sid",
    });
    expect(m[3].streaming).toBe(false);
  });

  test("turn boundary after promotion leaves the empty promoted bubble open for its reply", () => {
    let m: Message[] = [
      userMsg("u1", "first"),
      { ...assistantMsg("a1", "done with turn one", false), promptId: "p1" },
      userMsg("u2", "second"),
      { ...assistantMsg("a2", "", true, true), promptId: "p2" },
    ];

    m = applyUpdate(m, {
      sessionUpdate: "platform_prompt_started",
      sessionId: "test-sid",
      promptId: "p2",
    });
    expect(m[3].queued).toBe(false);

    m = applyUpdate(m, {
      sessionUpdate: "platform_turn_ended",
      sessionId: "test-sid",
    });
    expect(m[3].streaming).toBe(true);

    m = applyUpdate(m, txtChunk("answer to second"));
    expect(m).toHaveLength(4);
    expect(firstTextPart(m[3])).toBe("answer to second");

    m = applyUpdate(m, {
      sessionUpdate: "platform_turn_ended",
      sessionId: "test-sid",
    });
    expect(m[3].streaming).toBe(false);
  });

  test("an accepted prompt shows as queued when another reply is in flight", () => {
    const behindTurn: Message[] = [
      userMsg("u1", "first"),
      assistantMsg("a1", "streaming reply", true, false),
      userMsg("u2", "second"),
      { ...assistantMsg("a2", "", true), promptId: "p2" },
    ];
    const out = applyUpdate(behindTurn, {
      sessionUpdate: "platform_prompt_accepted",
      sessionId: "test-sid",
      promptId: "p2",
      queued: true,
    });
    expect(out[3].queued).toBe(true);
  });

  test("a prompt queued only for a cold session stays a plain busy reply", () => {
    const coldSend: Message[] = [
      userMsg("u1", "old conversation"),
      assistantMsg("a0", "old reply", false),
      userMsg("u2", "fresh send"),
      { ...assistantMsg("a2", "", true), promptId: "p2" },
    ];
    const out = applyUpdate(coldSend, {
      sessionUpdate: "platform_prompt_accepted",
      sessionId: "test-sid",
      promptId: "p2",
      queued: true,
    });
    expect(out[3].queued ?? false).toBe(false);
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

describe("appendInterruptedNotice", () => {
  test("appends one notice bubble when a turn was interrupted", () => {
    const out = appendInterruptedNotice([userMsg("u1", "hi")], {
      inFlight: false,
      interruptedAt: "2026-09-07T00:00:00Z",
    });
    expect(out).toHaveLength(2);
    expect(out[1].notice).toBe(true);
    expect(out[1].parts[0]).toMatchObject({ kind: "text" });
  });

  // TEST_SCENARIO: the runtime now says whether a Sleep, restart or move cut the turn, which is not the crash the old notice named. A turn still running says nothing at all.
  test("says a stop cut the turn, and stays quiet about a turn in flight", () => {
    const stopped = appendInterruptedNotice([], {
      inFlight: false,
      interruptedAt: "2026-09-07T00:00:00Z",
      interruptedByStop: true,
    });
    expect(stopped[0].parts[0]).toMatchObject({ kind: "text" });
    expect((stopped[0].parts[0] as { text: string }).text).toMatch(
      /was stopped/,
    );
    const inFlight = [userMsg("u1", "hi")];
    expect(
      appendInterruptedNotice(inFlight, {
        inFlight: true,
        interruptedAt: "2026-09-07T00:00:00Z",
      }),
    ).toBe(inFlight);
  });

  test("no-op when the session was not interrupted", () => {
    const start = [userMsg("u1", "hi")];
    expect(appendInterruptedNotice(start, undefined)).toBe(start);
  });
});

describe("failQueuedOnDisconnect", () => {
  function ourQueued(id: string, text: string): Message {
    return {
      ...assistantMsg(id, "", true, true),
      promptId: `p-${id}`,
      retryWith: { text },
    };
  }

  test("leaves our queued prompt unfailed, since the runtime parks it", () => {
    const out = failQueuedOnDisconnect([
      userMsg("u1", "first"),
      assistantMsg("a1", "partial reply", true, false),
      userMsg("u2", "second"),
      ourQueued("a2", "second"),
    ]);
    expect(out[1].streaming).toBe(false);
    expect(out[1].error).toBeUndefined();
    expect(firstTextPart(out[1])).toBe("partial reply");
    expect(out[3].streaming).toBe(false);
    expect(out[3].error).toBeUndefined();
  });

  test("behaves as finalizeAllStreaming when nothing of ours is queued", () => {
    const start: Message[] = [
      userMsg("u1", "hi"),
      assistantMsg("a1", "reply", true, false),
    ];
    expect(failQueuedOnDisconnect(start)).toEqual(finalizeAllStreaming(start));
  });

  test("drops a hidden queued send instead of failing it", () => {
    const hidden: Message = {
      ...assistantMsg("a1", "", true, true),
      promptId: "p-a1",
    };
    expect(failQueuedOnDisconnect([userMsg("u1", "x"), hidden])).toHaveLength(
      1,
    );
  });

  test("only finalizes a queued bubble that isn't ours to fail", () => {
    const out = failQueuedOnDisconnect([assistantMsg("a1", "", true, true)]);
    expect(out).toHaveLength(1);
    expect(out[0].streaming).toBe(false);
    expect(out[0].error).toBeUndefined();
  });

  test("finalizes a queued bubble that already has content", () => {
    const started: Message = {
      ...assistantMsg("a1", "already talking", true, true),
      promptId: "p-a1",
      retryWith: { text: "x" },
    };
    const out = failQueuedOnDisconnect([started]);
    expect(out[0].error).toBeUndefined();
    expect(firstTextPart(out[0])).toBe("already talking");
  });
});

describe("mergeLocalFailures", () => {
  const failed: Message = {
    ...userMsg("u9", "dropped"),
    error: { message: "Couldn't deliver", retryWith: { text: "dropped" } },
  };

  test("carries a locally-failed prompt across the reconnect rebuild", () => {
    const rebuilt = [userMsg("u1", "first"), assistantMsg("a1r", "reply")];
    const out = mergeLocalFailures(rebuilt, [...rebuilt, failed]);
    expect(out).toHaveLength(3);
    expect(out[2]).toBe(failed);
  });

  test("returns the rebuilt list untouched when nothing failed locally", () => {
    const rebuilt = [userMsg("u1", "hi"), assistantMsg("a1", "reply")];
    const previous = [
      ...rebuilt,
      { ...assistantMsg("a2", "", false), error: { message: "old" } },
    ];
    expect(mergeLocalFailures(rebuilt, previous)).toBe(rebuilt);
  });

  test("does not duplicate a failed prompt the rebuild already contains", () => {
    const rebuilt = [userMsg("u1", "first"), failed];
    expect(mergeLocalFailures(rebuilt, [failed])).toBe(rebuilt);
  });

  test("drops an interrupted agent bubble, since the replay owns agent content", () => {
    const interrupted: Message = {
      ...assistantMsg("a9", "partial", false),
      error: { message: "Interrupted", retryWith: { text: "prompt" } },
    };
    const rebuilt = [
      userMsg("u1", "prompt"),
      assistantMsg("a1r", "partial and the rest"),
    ];
    expect(mergeLocalFailures(rebuilt, [...rebuilt, interrupted])).toBe(
      rebuilt,
    );
  });
});

describe("applyUpdate — the harness's name for the prompt", () => {
  test("a replayed frame's prompt id lands on the reply being streamed", () => {
    /**
     * TEST_SCENARIO: history rebuilt from the harness's transcript has no
     * turnEnded to carry the id, so each replayed chunk names it instead.
     */
    const start: Message[] = [userMsg("u1", "hi")];
    const out = applyUpdate(start, txtChunk("hello"), undefined, "otel-2");
    expect(out[1].role).toBe("assistant");
    expect(out[1].telemetryPromptId).toBe("otel-2");
  });

  test("a frame without a prompt id leaves the reply's name alone", () => {
    const start: Message[] = [
      userMsg("u1", "hi"),
      { ...assistantMsg("a1", "hel", true), telemetryPromptId: "otel-3" },
    ];
    const out = applyUpdate(start, txtChunk("lo"));
    expect(out[1].telemetryPromptId).toBe("otel-3");
  });
});

describe("applyUpdate — turn correlation", () => {
  // TEST_SCENARIO: the runtime stamps each frame with its turn and names the turn it ends. Two turns stream at once (a background task's answer and the chat's own), so the ending of one closes only its reply and leaves the other streaming.
  test("a named turn end closes only that turn's reply", () => {
    let messages = applyUpdate(
      [],
      txtChunk("background result"),
      undefined,
      undefined,
      "turn-bg",
    );
    messages = applyUpdate(
      messages,
      txtChunk("foreground answer"),
      undefined,
      undefined,
      "turn-fg",
    );
    expect(messages.map((m) => m.turnId)).toEqual(["turn-bg", "turn-fg"]);
    const closed = applyUpdate(messages, {
      sessionUpdate: "platform_turn_ended",
      sessionId: "test-sid",
      turnId: "turn-bg",
    });
    expect(closed.map((m) => m.streaming)).toEqual([false, true]);
  });

  // TEST_SCENARIO: a frame with no turn id (an older runtime, a replay) keeps the old rule of closing the reply being streamed, so nothing regresses before the runtime speaks turns.
  test("a turn end without a turn id still closes the active reply", () => {
    const out = applyUpdate(
      [userMsg("u1", "hi"), assistantMsg("a1", "hello", true)],
      { sessionUpdate: "platform_turn_ended", sessionId: "test-sid" },
    );
    expect(out[1].streaming).toBe(false);
  });
});

describe("queued and steered prompts", () => {
  // TEST_SCENARIO: A prompt sent mid-turn is steered into the running turn rather than queued. Its bubble stays, its waiting placeholder goes, and the turn opens a reply below it, where the agent's next output lands.
  test("a steered prompt keeps its message and continues the turn below it", () => {
    const start: Message[] = [
      userMsg("turn-a", "first"),
      { ...assistantMsg("a1", "working", true), promptId: "turn-a" },
      userMsg("turn-b", "mid-turn"),
      { ...assistantMsg("a2", "", true, true), promptId: "turn-b" },
    ];
    const out = applyUpdate(start, {
      sessionUpdate: "platform_prompt_accepted",
      sessionId: "s",
      promptId: "turn-b",
      queued: true,
      steered: true,
    });
    expect(out.map((m) => [m.role, m.id, m.streaming, m.queued])).toEqual([
      ["user", "turn-a", false, undefined],
      ["assistant", "a1", false, undefined],
      ["user", "turn-b", false, false],
      ["assistant", out[3]!.id, true, undefined],
    ]);
    expect(out[3]!.turnId).toBe("turn-a");
  });

  // TEST_SCENARIO: A reload brings back the runtime's queue, so a prompt still waiting behind a turn shows as waiting again rather than vanishing.
  test("the runtime's queue comes back as waiting sends", () => {
    const out = appendQueuedSends(
      [],
      [
        {
          promptId: "queued-1",
          blocks: [{ type: "text", text: "waiting" }],
          queuedAt: "2026-10-27T00:00:00Z",
          editable: true,
        },
      ],
    );
    expect(out.map((m) => [m.role, m.id, m.queued, m.promptId])).toEqual([
      ["user", "queued-1", undefined, undefined],
      ["assistant", out[1]!.id, true, "queued-1"],
    ]);
    expect(firstTextPart(out[0]!)).toBe("waiting");
    const started = applyUpdate(out, {
      sessionUpdate: "platform_prompt_started",
      sessionId: "s",
      promptId: "queued-1",
    });
    expect(started[1]!.queued).toBe(false);
    expect(started).toHaveLength(2);
  });
});
