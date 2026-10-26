// TEST_OVERVIEW: The chat input offers a list of `/<name>` commands. The list opens only for a `/` at the start of the input or of a line, never for one inside a word or a path, and closes at the first white space. It filters by name first, prefix matches before others, then by description. Picking a command replaces the typed token with `/<name> ` and keeps the rest of the prompt. A Codex skill, which the harness names `$name`, is inserted as a `$name` mention. The harness's own list and the agent's skills merge into one list, one entry per name.
import { describe, expect, it } from "vitest";

import {
  commandTrigger,
  filterCommands,
  insertCommand,
  lastReportedCommands,
  mergeCommands,
} from "../../modules/sessions/lib/skill-commands.js";

const commands = [
  { name: "review", description: "Review the diff" },
  { name: "grill-me", description: "Interview the user about a plan" },
  { name: "pr-open", description: "Open a pull request for review" },
  { name: "agent-browser", description: "Drive the browser" },
];

describe("where a command is typed", () => {
  // TEST_SCENARIO: a `/` as the first character opens the list, and the text after it, up to the caret, filters it.
  it("opens on a slash at the start of the input", () => {
    expect(commandTrigger("/gri", 4)).toEqual({
      start: 0,
      end: 4,
      query: "gri",
    });
    expect(commandTrigger("/", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  // TEST_SCENARIO: a `/` at the start of a later line opens the list too, so a command can follow a pasted note.
  it("opens on a slash after a newline", () => {
    expect(commandTrigger("note\n/re", 8)).toEqual({
      start: 5,
      end: 8,
      query: "re",
    });
  });

  // TEST_SCENARIO: a `/` inside a word or a path is part of the prompt, not a command, so nothing opens for `src/foo` or `a /b`.
  it("stays closed for a slash inside a word or a path", () => {
    expect(commandTrigger("src/foo", 7)).toBeNull();
    expect(commandTrigger("see /etc", 8)).toBeNull();
  });

  // TEST_SCENARIO: a space after the name ends the command: the user is typing the rest of the prompt, so the list closes.
  it("closes after a space", () => {
    expect(commandTrigger("/review now", 11)).toBeNull();
    expect(commandTrigger("/review ", 8)).toBeNull();
  });

  // TEST_SCENARIO: with the caret back inside the name, the token still runs to its end, so a pick replaces the whole name.
  it("covers the whole token when the caret is inside it", () => {
    expect(commandTrigger("/review now", 3)).toEqual({
      start: 0,
      end: 7,
      query: "re",
    });
  });

  // TEST_SCENARIO: the caret before the slash is not in a command.
  it("stays closed with the caret before the slash", () => {
    expect(commandTrigger("/review", 0)).toBeNull();
  });
});

describe("filtering the list", () => {
  // TEST_SCENARIO: `/gri` lists grill-me.
  it("matches a name prefix", () => {
    expect(filterCommands(commands, "gri").map((c) => c.name)).toEqual([
      "grill-me",
    ]);
  });

  // TEST_SCENARIO: a prefix match ranks above a name that only contains the text, which ranks above a description match.
  it("puts prefix matches first, then names, then descriptions", () => {
    expect(filterCommands(commands, "re").map((c) => c.name)).toEqual([
      "review",
      "pr-open",
    ]);
    expect(filterCommands(commands, "brow").map((c) => c.name)).toEqual([
      "agent-browser",
    ]);
    expect(filterCommands(commands, "plan").map((c) => c.name)).toEqual([
      "grill-me",
    ]);
  });

  // TEST_SCENARIO: case does not matter, and an empty query lists everything in order.
  it("ignores case and lists all for an empty query", () => {
    expect(filterCommands(commands, "GRI").map((c) => c.name)).toEqual([
      "grill-me",
    ]);
    expect(filterCommands(commands, "")).toEqual(commands);
  });

  // TEST_SCENARIO: a Codex skill reported as `$name` matches the typed name without its `$`.
  it("matches a mention by its name", () => {
    expect(
      filterCommands([{ name: "$grill-me", description: "" }], "gri").map(
        (c) => c.name,
      ),
    ).toEqual(["$grill-me"]);
  });

  // TEST_SCENARIO: no match leaves the list empty, so it closes.
  it("is empty when nothing matches", () => {
    expect(filterCommands(commands, "zzz")).toEqual([]);
  });
});

describe("picking a command", () => {
  // TEST_SCENARIO: a pick replaces the typed token with `/<name> ` and puts the caret after the space.
  it("inserts the name and a space", () => {
    const text = "/gri";
    expect(insertCommand(text, commandTrigger(text, 4)!, "grill-me")).toEqual({
      text: "/grill-me ",
      caret: 10,
    });
  });

  // TEST_SCENARIO: the rest of the prompt after the token stays, with one space between it and the name.
  it("keeps the rest of the prompt", () => {
    const text = "/re  the change";
    expect(insertCommand(text, commandTrigger(text, 3)!, "review")).toEqual({
      text: "/review the change",
      caret: 8,
    });
  });

  // TEST_SCENARIO: text before the command's line stays as it is.
  it("keeps the lines before the command", () => {
    const text = "note\n/re";
    expect(insertCommand(text, commandTrigger(text, 8)!, "review").text).toBe(
      "note\n/review ",
    );
  });

  // TEST_SCENARIO: Codex runs a skill from a `$name` mention, not from `/$name`, so its skill is inserted as the mention.
  it("inserts a mention for a Codex skill", () => {
    const text = "/gri";
    expect(
      insertCommand(text, commandTrigger(text, 4)!, "$grill-me").text,
    ).toBe("$grill-me ");
  });
});

describe("the list the input offers", () => {
  // TEST_SCENARIO: a skill the harness also reported shows once, with the harness's entry; a skill it has not reported yet still shows; the list is sorted by name.
  it("merges reported commands and skills by name", () => {
    expect(
      mergeCommands(
        [
          { name: "review", description: "Review the diff" },
          { name: "grill-me", description: "" },
        ],
        [
          { name: "grill-me", description: "Interview the user" },
          { name: "pr-open", description: "Open a pull request" },
        ],
      ),
    ).toEqual([
      { name: "grill-me", description: "Interview the user" },
      { name: "pr-open", description: "Open a pull request" },
      { name: "review", description: "Review the diff" },
    ]);
  });

  // TEST_SCENARIO: a replayed session carries several `available_commands_update` frames; the newest one is the list, and one with no description gets an empty one.
  it("reads the newest reported list from a replay", () => {
    expect(
      lastReportedCommands([
        {
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: [{ name: "old", description: "Old" }],
          },
        },
        {
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: [
              { name: "new", description: "New" },
              { name: "", description: "Blank" },
            ],
          },
        },
        {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hi" },
          },
        },
      ]),
    ).toEqual([{ name: "new", description: "New" }]);
    expect(lastReportedCommands([])).toBeNull();
  });
});
