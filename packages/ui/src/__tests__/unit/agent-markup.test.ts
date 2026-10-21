// TEST_OVERVIEW: An agent's reply text can carry markup the agent wrote itself: reasoning in `<thinking>` tags, learned from replayed history, and framing tags such as `<how-to-respond>` it echoes from its prompt. The session view shows the reasoning as a thought and drops the framing, and leaves markup that is quoted inline or inside a code fence as written.
import { expect, it } from "vitest";

import { withoutAgentMarkup } from "../../modules/sessions/lib/agent-markup.js";
import type { MessagePart } from "../../types.js";

const splitAgentText = (text: string) =>
  withoutAgentMarkup([{ kind: "text", text }]);

// TEST_SCENARIO: a `<thinking>` passage between two paragraphs becomes a thought between two text parts.
it("turns a thinking passage into a thought", () => {
  expect(
    splitAgentText(
      "Ran the formatter.\n\n<thinking>Prettier rewrote parts I hadn't touched.\n</thinking>\n\nReverted them.",
    ),
  ).toEqual([
    { kind: "text", text: "Ran the formatter." },
    { kind: "thought", text: "Prettier rewrote parts I hadn't touched." },
    { kind: "text", text: "Reverted them." },
  ]);
});

// TEST_SCENARIO: a reply that is only reasoning, as the screenshot showed, leaves no empty text part behind.
it("leaves no empty text around a lone thinking passage", () => {
  expect(splitAgentText("<thinking>Checking the tests.</thinking>\n")).toEqual([
    { kind: "thought", text: "Checking the tests." },
  ]);
});

// TEST_SCENARIO: while a reply streams, a thinking passage whose closing tag has not arrived yet already shows as a thought.
it("treats an unclosed thinking passage as a thought to the end", () => {
  expect(splitAgentText("Done.\n<thinking>Still weighing")).toEqual([
    { kind: "text", text: "Done." },
    { kind: "thought", text: "Still weighing" },
  ]);
});

// TEST_SCENARIO: framing tags the agent echoes, with or without attributes, disappear with their content.
it("drops echoed framing tags", () => {
  expect(
    splitAgentText(
      '<how-to-respond>\nAnswer in plain text.\n</how-to-respond>\nHere it is.\n<system-reminder kind="x">ignore</system-reminder>',
    ),
  ).toEqual([{ kind: "text", text: "Here it is." }]);
});

// TEST_SCENARIO: a reply that talks about the tags, inline or in a code fence, keeps them as written.
it("keeps markup that is quoted inline or fenced", () => {
  const text =
    "The `<thinking>` tag leaks.\n\n```xml\n<how-to-respond>\nx\n</how-to-respond>\n```\n\nSee <thinking> above.";
  expect(splitAgentText(text)).toEqual([{ kind: "text", text }]);
});

// TEST_SCENARIO: parts without markup come back as the same objects, and a split part keeps its message id.
it("rewrites only the text parts that carry markup", () => {
  const plain: MessagePart = { kind: "text", text: "a < b", messageId: "m1" };
  const tool: MessagePart = {
    kind: "tool",
    toolCallId: "t",
    title: "ls",
    status: "completed",
  };
  const marked: MessagePart = {
    kind: "text",
    text: "<thinking>hm</thinking>\nok",
    messageId: "m2",
  };
  const out = withoutAgentMarkup([plain, tool, marked]);
  expect(out[0]).toBe(plain);
  expect(out[1]).toBe(tool);
  expect(out.slice(2)).toEqual([
    { kind: "thought", text: "hm", messageId: "m2" },
    { kind: "text", text: "ok", messageId: "m2" },
  ]);
});
