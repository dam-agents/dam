// TEST_OVERVIEW: a reply whose turn the platform ended by sending its chat form back to the agent never shows the broken form: its blocks leave the replayed conversation and show that the agent is fixing the form, until a later reply answers in its place.
import { describe, expect, test } from "vitest";

import { collectBlocks } from "../../modules/a2ui/lib/collect-blocks.js";
import { sentBackBlocks } from "../../modules/a2ui/lib/sent-back.js";
import type { Message } from "../../types.js";

const BLOCK = "Pick one:\n<a2ui-json>\n[]\n</a2ui-json>";

function reply(id: string, text: string, chatFormFix?: number): Message {
  return {
    id,
    role: "assistant",
    parts: [{ kind: "text", text }],
    streaming: false,
    ...(chatFormFix !== undefined && { chatFormFix }),
  };
}

describe("A2UI sent back for a fix", () => {
  // TEST_SCENARIO: the turn ended with a fix on its way; the broken block must not be replayed, so the user sees only that the agent is fixing it.
  test("hides a sent-back block while the agent fixes it", () => {
    const messages = [reply("broken", BLOCK, 1)];

    expect(collectBlocks(messages)).toEqual([]);
    expect([...sentBackBlocks(messages)]).toEqual([["broken:0:0", "fixing"]]);
  });

  // TEST_SCENARIO: the fixed reply arrived; it is replayed as usual and the broken one only says it was answered again.
  test("marks a sent-back block replaced once the next reply arrives", () => {
    const messages = [reply("broken", BLOCK, 1), reply("fixed", BLOCK)];

    expect(collectBlocks(messages).map((block) => block.messageId)).toEqual([
      "fixed",
    ]);
    expect(sentBackBlocks(messages).get("broken:0:0")).toBe("replaced");
  });
});
