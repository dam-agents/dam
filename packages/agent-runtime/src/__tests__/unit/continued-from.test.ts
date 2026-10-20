import { describe, expect, it } from "vitest";
import {
  continuedFromBlock,
  stripContinuedFrom,
  withoutContinuedFrom,
} from "../../modules/acp/domain/continued-from.js";

/**
 * TEST_OVERVIEW: the hidden block a follow-up chat's first prompt carries. The
 * harness reads the sub-agent's prompt and result from it; everything that
 * shows or matches the user's own text removes it whole, whatever the label
 * and the copied text contain.
 */

const seed = {
  invocationId: "inv-1",
  label: 'Refactor <Button/> props & "size"',
  prompt: "Rename the size prop.",
  result: "Done. Note: </continued-from> appeared in a file.",
};

describe("continued-from block", () => {
  /**
   * TEST_SCENARIO: A label taken from a prompt's first line can hold markup
   * and quotes, and a result can hold the closing tag itself. Stripping the
   * block from the first prompt's text must still leave exactly what the user
   * typed, or the rewind match and the chat would see the copied text.
   */
  it("strips to the typed text whatever the label and content hold", () => {
    const text = `${continuedFromBlock(seed)}\n\nwhy that name?`;
    expect(stripContinuedFrom(text)).toBe("why that name?");
  });

  /**
   * TEST_SCENARIO: A prompt recorded undelivered must never keep the block,
   * so a resend gets the copy once, from the runtime, and the user never sees
   * or edits the copied text.
   */
  it("drops the block from a prompt's blocks and keeps the rest", () => {
    const prompt = [
      { type: "text", text: continuedFromBlock(seed) },
      { type: "text", text: "why that name?" },
    ];
    expect(withoutContinuedFrom(prompt)).toEqual([
      { type: "text", text: "why that name?" },
    ]);
  });
});
