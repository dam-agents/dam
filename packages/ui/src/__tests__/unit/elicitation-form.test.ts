import type { ElicitationSchema } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";

import {
  EMPTY_ANSWER,
  type FormAnswers,
  formContentOf,
  formFieldsOf,
  isFormComplete,
  withOther,
  withPick,
} from "../../modules/sessions/lib/elicitation-form.js";

/**
 * TEST_OVERVIEW: the chat's reading of an ACP form elicitation.
 *
 * The agent sends a JSON schema; the chat shows one field per question and
 * sends the answers back as `accept` content keyed like the schema. The
 * schema claude-agent-acp sends for AskUserQuestion is pinned here as it
 * comes off the wire: `question_<n>` is a titled `oneOf` (or, for a
 * multi-select, an array of `anyOf`) and `question_<n>_custom` is that
 * question's free-text box. Every choice must keep its description, and must
 * offer a free-text answer even when the agent sends no such box.
 */

const askUserQuestion: ElicitationSchema = {
  type: "object",
  properties: {
    question_0: {
      type: "string",
      title: "Database",
      description: "Which database?",
      oneOf: [
        { const: "Postgres", title: "Postgres", description: "Relational" },
        { const: "Redis", title: "Redis", description: "In memory" },
      ],
    },
    question_0_custom: {
      type: "string",
      title: "Other",
      description: "Type your own answer (optional).",
    },
    question_1: {
      type: "array",
      title: "Features",
      items: {
        anyOf: [
          { const: "Auth", title: "Auth" },
          { const: "Billing", title: "Billing" },
        ],
      },
    },
    question_1_custom: { type: "string", title: "Other" },
  },
};

function answers(over: Record<string, Partial<typeof EMPTY_ANSWER>>) {
  const out: FormAnswers = {};
  for (const [k, v] of Object.entries(over)) out[k] = { ...EMPTY_ANSWER, ...v };
  return out;
}

describe("formFieldsOf", () => {
  /**
   * TEST_SCENARIO: An AskUserQuestion form with one single-select and one
   * multi-select question. Each must become one choice field that keeps its
   * options' titles and descriptions, with its `_custom` box folded in as
   * its "Other" answer rather than shown as a separate question.
   */
  it("should read each question with its options and its Other box", () => {
    const fields = formFieldsOf(askUserQuestion);
    expect(fields).toEqual([
      {
        kind: "choice",
        key: "question_0",
        title: "Database",
        description: "Which database?",
        required: false,
        multiple: false,
        options: [
          { value: "Postgres", title: "Postgres", description: "Relational" },
          { value: "Redis", title: "Redis", description: "In memory" },
        ],
        otherKey: "question_0_custom",
      },
      {
        kind: "choice",
        key: "question_1",
        title: "Features",
        description: undefined,
        required: false,
        multiple: true,
        options: [
          { value: "Auth", title: "Auth" },
          { value: "Billing", title: "Billing" },
        ],
        otherKey: "question_1_custom",
      },
    ]);
  });

  /**
   * TEST_SCENARIO: A form from an MCP server mixes a plain enum, a text
   * field, a number and a yes/no. Each must keep its kind and its place, and
   * the enum must still get an Other answer of the chat's own.
   */
  it("should keep plain fields and give a bare enum an Other answer", () => {
    const fields = formFieldsOf({
      type: "object",
      required: ["region"],
      properties: {
        region: { type: "string", enum: ["eu", "us"] },
        note: { type: "string", title: "Note" },
        count: { type: "integer" },
        confirm: { type: "boolean" },
      },
    });
    expect(fields.map((f) => [f.key, f.kind, f.required])).toEqual([
      ["region", "choice", true],
      ["note", "text", false],
      ["count", "integer", false],
      ["confirm", "boolean", false],
    ]);
    expect(fields[0]).toMatchObject({ otherKey: null });
  });
});

describe("formContentOf", () => {
  /**
   * TEST_SCENARIO: The user picks an option and also types into that
   * question's Other box. Both must go back under their own keys, so
   * claude-agent-acp can keep the pick and add the text as a note.
   */
  it("should send a pick and its typed note under their own keys", () => {
    const fields = formFieldsOf(askUserQuestion);
    const content = formContentOf(
      fields,
      answers({
        question_0: { picked: ["Redis"], other: " only for sessions " },
        question_1: { picked: ["Auth", "Billing"] },
      }),
    );
    expect(content).toEqual({
      question_0: "Redis",
      question_0_custom: "only for sessions",
      question_1: ["Auth", "Billing"],
    });
  });

  /**
   * TEST_SCENARIO: The agent's options are all wrong, and its schema has no
   * Other box. The text the user types must become the answer itself — for
   * a multi-select, one more item beside the ticked ones.
   */
  it("should make typed text the answer of a field with no Other box", () => {
    const fields = formFieldsOf({
      type: "object",
      properties: {
        region: { type: "string", enum: ["eu", "us"] },
        tags: { type: "array", items: { enum: ["a", "b"] } },
      },
    });
    expect(
      formContentOf(
        fields,
        answers({
          region: { picked: ["eu"], other: "ap-south" },
          tags: { picked: ["a"], other: "c" },
        }),
      ),
    ).toEqual({ region: "ap-south", tags: ["a", "c"] });
  });
});

describe("withPick and withOther", () => {
  /**
   * TEST_SCENARIO: A single choice with no Other box of the agent's own: the
   * typed text replaces the pick. So typing must clear the radio, and a new
   * pick must clear the text, or the screen shows one answer and sends
   * another. With the agent's own Other box both are kept, as a pick and a
   * note.
   */
  it("should keep what is shown equal to what is sent", () => {
    const [bare] = formFieldsOf({
      type: "object",
      properties: { region: { type: "string", enum: ["eu", "us"] } },
    });
    const [paired] = formFieldsOf(askUserQuestion);
    if (bare?.kind !== "choice" || paired?.kind !== "choice")
      throw new Error("expected choice fields");

    const typed = withOther(bare, withPick(bare, EMPTY_ANSWER, "eu"), "ap");
    expect(typed).toMatchObject({ picked: [], other: "ap" });
    expect(withPick(bare, typed, "us")).toMatchObject({
      picked: ["us"],
      other: "",
    });

    const noted = withOther(
      paired,
      withPick(paired, EMPTY_ANSWER, "Redis"),
      "note",
    );
    expect(noted).toMatchObject({ picked: ["Redis"], other: "note" });
  });
});

describe("formContentOf numbers", () => {
  /**
   * TEST_SCENARIO: An integer field gets a fraction and a number field gets
   * text. Neither may be sent as an answer the schema would refuse; a whole
   * number and a fraction in the right fields are sent as numbers.
   */
  it("should send only numbers the field allows", () => {
    const fields = formFieldsOf({
      type: "object",
      properties: { count: { type: "integer" }, ratio: { type: "number" } },
    });
    expect(
      formContentOf(
        fields,
        answers({ count: { text: "1.5" }, ratio: { text: "x" } }),
      ),
    ).toEqual({});
    expect(
      formContentOf(
        fields,
        answers({ count: { text: "3" }, ratio: { text: "0.5" } }),
      ),
    ).toEqual({ count: 3, ratio: 0.5 });
  });
});

describe("isFormComplete", () => {
  /**
   * TEST_SCENARIO: A required choice is unanswered, so the form cannot be
   * sent. Typing an Other answer instead of picking must be enough.
   */
  it("should accept a typed answer for a required choice", () => {
    const schema: ElicitationSchema = {
      ...askUserQuestion,
      required: ["question_0"],
    };
    const fields = formFieldsOf(schema);
    expect(isFormComplete(fields, {})).toBe(false);
    expect(
      isFormComplete(fields, answers({ question_0: { other: "SQLite" } })),
    ).toBe(true);
  });
});
