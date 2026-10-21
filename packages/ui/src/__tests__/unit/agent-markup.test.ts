// TEST_OVERVIEW: An agent's reply can carry markup the agent wrote itself. The session view shows a `<thinking>` passage as a thought and drops echoed framing tags, but leaves a tag quoted in a sentence or in code as written.
import { expect, it } from "vitest";

import {
  blockKey,
  collectBlocks,
  partKey,
} from "../../modules/a2ui/lib/collect-blocks.js";
import { withoutAgentMarkup } from "../../modules/acp/agent-markup.js";

const split = (text: string) => withoutAgentMarkup([{ kind: "text", text }]);

// TEST_SCENARIO: thinking becomes a thought, a framing tag disappears, and quoted markup stays.
it("folds thinking, drops framing and keeps quoted markup", () => {
  expect(
    split(
      "<how-to-respond>x</how-to-respond>\nDone.\n<thinking>Still weighing",
    ),
  ).toEqual([
    { kind: "text", text: "Done." },
    { kind: "thought", text: "Still weighing" },
  ]);
  const quoted = "The `<thinking>` tag.\n\n```\n<thinking>x</thinking>\n```";
  expect(split(quoted)).toEqual([{ kind: "text", text: quoted }]);
});

// TEST_SCENARIO: a framing tag without its closing tag is text the agent meant to show.
it("keeps the text after an unclosed framing tag", () => {
  const text = "<system-reminder> is a harness tag.\nIt frames a turn.";
  expect(split(text)).toEqual([{ kind: "text", text }]);
});

// TEST_SCENARIO: a form after a thought keeps the key the chat draws it under.
it("keys a form by the part the chat draws it in", () => {
  const text = "<thinking>Ask</thinking>\nPick:\n<a2ui-json>[]</a2ui-json>";
  const [block] = collectBlocks([
    {
      id: "m",
      role: "assistant",
      streaming: false,
      parts: [{ kind: "text", text }],
    },
  ]);
  const drawn = split(text).findIndex((p) => p.kind === "text");
  expect(block.key).toBe(blockKey(partKey("m", drawn), 0));
});
