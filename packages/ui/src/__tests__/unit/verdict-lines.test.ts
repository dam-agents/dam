// TEST_OVERVIEW: the line under a tool call that says how a person answered its approval comes from the verdicts the runtime keeps, so it shows after a reload and names who gave it. A line this tab drew when its viewer answered takes the recorded answerer rather than showing twice, and a person sees "by <email>" only for an answer someone else gave.
import type { AgentAccess, PlatformVerdict } from "api-server-api";
import { describe, expect, it } from "vitest";

import { senderNames } from "../../modules/sessions/lib/sender-names.js";
import { withVerdicts } from "../../modules/sessions/lib/verdicts.js";
import type { Message, VerdictPart } from "../../types.js";

const OWNER = { sub: "owner-sub", email: "owner@example.com" };
const EDITOR = { sub: "editor-sub", email: "editor@example.com" };

const toolReply: Message = {
  id: "r1",
  role: "assistant",
  parts: [
    {
      kind: "tool",
      toolCallId: "tc-1",
      title: "rm -rf build",
      status: "completed",
    },
  ],
  streaming: false,
};

const allowedByEditor: PlatformVerdict = {
  toolCallId: "tc-1",
  kind: "allow_once",
  by: EDITOR,
};

const verdictsIn = (messages: Message[]): VerdictPart[] =>
  messages.flatMap((m) => m.parts.filter((p) => p.kind === "verdict"));

describe("verdict lines", () => {
  // TEST_SCENARIO: AC-7, after a reload the tab holds no line of its own; the recorded verdict draws it under its tool call.
  it("draws a recorded verdict after a reload", () => {
    expect(verdictsIn(withVerdicts([toolReply], [allowedByEditor]))).toEqual([
      {
        kind: "verdict",
        toolCallId: "tc-1",
        label: "Allowed once",
        subject: "rm -rf build",
        allowed: true,
        by: EDITOR,
      },
    ]);
  });

  // TEST_SCENARIO: the person who answered already sees the line their tab drew; the recorded verdict adds who gave it instead of a second line.
  it("does not draw a line twice", () => {
    const answered: Message = {
      ...toolReply,
      parts: [
        ...toolReply.parts,
        {
          kind: "verdict",
          toolCallId: "tc-1",
          label: "Allowed once",
          subject: "rm -rf build",
          allowed: true,
        },
      ],
    };
    const lines = verdictsIn(withVerdicts([answered], [allowedByEditor]));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.by).toEqual(EDITOR);
  });

  // TEST_SCENARIO: AC-5, the owner reads "by <editor's email>"; the editor reads their own answer as it is today.
  it("names only someone else", () => {
    const access: AgentAccess = { role: "owner", editors: [], permissions: [] };
    expect(senderNames(OWNER.sub, access).otherName(EDITOR)).toBe(
      "editor@example.com",
    );
    expect(senderNames(EDITOR.sub, access).otherName(EDITOR)).toBeNull();
  });
});
