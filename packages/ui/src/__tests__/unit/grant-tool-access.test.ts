// TEST_OVERVIEW: The tool access of one Agent on one MCP connection, as the web app reads and edits it. A tool follows its group, the tools that read or the tools that post or change, unless it has its own rule; a tool the stored list does not name is in the second group. The summary names a common setting ("Read only", "Asks before writing", "Allows everything", "Blocks everything") and counts the tools of any other, and its tone warns where a tool that does not read runs without asking. Setting a group or a tool keeps only the tools that differ from their group as exceptions.
import type { ConnectionTool, GrantToolAccess } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  accessSummary,
  byRisk,
  exceptionsOf,
  sameAccess,
  toolRuleOf,
  toolsOfGroup,
  withGroupRule,
  withoutException,
  withToolRule,
  writesWithoutAsking,
} from "../../modules/connections/lib/grant-tool-access.js";

const SLACK_TOOLS: readonly ConnectionTool[] = [
  ...[
    "slack_search_public",
    "slack_read_channel",
    "slack_read_thread",
    "slack_read_user_profile",
  ].map((name) => ({ name, readOnly: true })),
  ...[
    "slack_send_message",
    "slack_schedule_message",
    "slack_create_canvas",
    "slack_add_reaction",
    "slack_create_conversation",
    "slack_update_canvas",
    "slack_send_message_draft",
  ].map((name) => ({ name, readOnly: false })),
];

const access = (
  read: GrantToolAccess["read"],
  write: GrantToolAccess["write"],
  overrides: GrantToolAccess["overrides"] = {},
): GrantToolAccess => ({ read, write, overrides });

describe("the rule of one tool", () => {
  // TEST_SCENARIO: a tool with no rule of its own follows its group, and a tool the stored list does not name follows the tools that post or change, as the gateway decides it.
  it("follows its group unless it has its own rule", () => {
    const a = access("allow", "ask", { slack_add_reaction: "allow" });
    expect(toolRuleOf(a, "slack_read_channel", SLACK_TOOLS)).toBe("allow");
    expect(toolRuleOf(a, "slack_send_message", SLACK_TOOLS)).toBe("ask");
    expect(toolRuleOf(a, "slack_add_reaction", SLACK_TOOLS)).toBe("allow");
    expect(toolRuleOf(a, "slack_new_tool", SLACK_TOOLS)).toBe("ask");
    expect(toolRuleOf(a, "slack_read_channel", null)).toBe("ask");
  });
});

describe("the summary of an Agent's access", () => {
  // TEST_SCENARIO: the four common settings carry their own names, and only allowing everything warns.
  it("names the common settings", () => {
    expect(accessSummary(access("allow", "block"), SLACK_TOOLS)).toEqual({
      text: "Read only",
      tone: "quiet",
    });
    expect(accessSummary(access("allow", "ask"), SLACK_TOOLS)).toEqual({
      text: "Asks before writing",
      tone: "asks",
    });
    expect(accessSummary(access("allow", "allow"), SLACK_TOOLS)).toEqual({
      text: "Allows everything",
      tone: "writes",
    });
    expect(accessSummary(access("block", "block"), SLACK_TOOLS)).toEqual({
      text: "Blocks everything",
      tone: "quiet",
    });
  });

  // TEST_SCENARIO: any other setting counts what asks, what writes without asking and what is blocked, and warns as soon as one tool that does not read runs without asking.
  it("counts the tools of any other setting", () => {
    expect(
      accessSummary(
        access("allow", "ask", {
          slack_add_reaction: "allow",
          slack_create_conversation: "block",
        }),
        SLACK_TOOLS,
      ),
    ).toEqual({
      text: "Asks before 5 tools · 1 writes without asking · 1 blocked",
      tone: "writes",
    });
    expect(
      accessSummary(
        access("allow", "block", {
          slack_send_message: "allow",
          slack_add_reaction: "allow",
        }),
        SLACK_TOOLS,
      ),
    ).toEqual({ text: "2 write without asking · 5 blocked", tone: "writes" });
    expect(
      accessSummary(
        access("allow", "block", { slack_send_message: "ask" }),
        SLACK_TOOLS,
      ),
    ).toEqual({ text: "Asks before 1 tool · 6 blocked", tone: "asks" });
  });

  // TEST_SCENARIO: a tool the server adds later follows the write group, so a write group that allows writes without asking even when every listed tool that writes is blocked one by one; the tone warns and the text says that new tools write without asking.
  it("warns when only tools the server adds later would write", () => {
    const blockedOneByOne = access(
      "allow",
      "allow",
      Object.fromEntries(
        SLACK_TOOLS.filter((t) => !t.readOnly).map((t) => [t.name, "block"]),
      ),
    );
    expect(accessSummary(blockedOneByOne, SLACK_TOOLS)).toEqual({
      text: "7 blocked · new tools write without asking",
      tone: "writes",
    });
    expect(writesWithoutAsking(blockedOneByOne, SLACK_TOOLS)).toBe(true);
  });

  // TEST_SCENARIO: "writes without asking" follows the CLI's rule: the write group allows, or a tool that is not a listed read tool has its own allow; an allow on a read tool does not count.
  it("decides writes without asking as the CLI does", () => {
    expect(writesWithoutAsking(access("block", "ask"), SLACK_TOOLS)).toBe(
      false,
    );
    expect(
      writesWithoutAsking(
        access("block", "block", { slack_read_channel: "allow" }),
        SLACK_TOOLS,
      ),
    ).toBe(false);
    expect(
      writesWithoutAsking(
        access("allow", "block", { slack_send_message: "allow" }),
        SLACK_TOOLS,
      ),
    ).toBe(true);
    expect(
      writesWithoutAsking(
        access("allow", "block", { slack_delete_message: "allow" }),
        SLACK_TOOLS,
      ),
    ).toBe(true);
  });

  // TEST_SCENARIO: before the tool list is read for the first time only the two group rules are known, so the summary is said from them.
  it("speaks from the group rules where no tool is listed", () => {
    expect(accessSummary(access("allow", "block"), null).text).toBe(
      "Read only",
    );
    expect(accessSummary(access("allow", "ask"), []).text).toBe(
      "Asks before writing",
    );
    expect(accessSummary(access("ask", "block"), null)).toEqual({
      text: "Asks before reading · Blocks writing",
      tone: "asks",
    });
    expect(accessSummary(access("block", "allow"), null)).toEqual({
      text: "Blocks reading · Writes without asking",
      tone: "writes",
    });
  });

  // TEST_SCENARIO: a list of agents puts the ones that write without asking first, then the ones that ask, and an agent with no tool access last.
  it("orders by risk", () => {
    const summaries = [
      undefined,
      { text: "Read only", tone: "quiet" as const },
      { text: "Allows everything", tone: "writes" as const },
      { text: "Asks before writing", tone: "asks" as const },
    ];
    expect([...summaries].sort(byRisk).map((s) => s?.tone)).toEqual([
      "writes",
      "asks",
      "quiet",
      undefined,
    ]);
  });
});

describe("changing an Agent's access", () => {
  // TEST_SCENARIO: a tool set to another rule than its group is an exception; set back to the group's rule, or reset, it is no longer one.
  it("keeps a tool as an exception only while it differs from its group", () => {
    const start = access("allow", "ask");
    const allowed = withToolRule(
      start,
      "slack_add_reaction",
      "allow",
      SLACK_TOOLS,
    );
    expect(allowed.overrides).toEqual({ slack_add_reaction: "allow" });
    expect(exceptionsOf(allowed, "write", SLACK_TOOLS)).toEqual([
      { name: "slack_add_reaction", rule: "allow" },
    ]);
    expect(
      withToolRule(allowed, "slack_add_reaction", "ask", SLACK_TOOLS).overrides,
    ).toEqual({});
    expect(withoutException(allowed, "slack_add_reaction").overrides).toEqual(
      {},
    );
  });

  // TEST_SCENARIO: setting a group keeps the exceptions that still differ from it and drops the ones that now match it.
  it("drops the exceptions a group change makes equal", () => {
    const start = access("allow", "ask", {
      slack_add_reaction: "allow",
      slack_create_conversation: "block",
    });
    expect(withGroupRule(start, "write", "allow", SLACK_TOOLS)).toEqual(
      access("allow", "allow", { slack_create_conversation: "block" }),
    );
  });

  // TEST_SCENARIO: Save is offered only for a real change, whatever order the exceptions were set in.
  it("compares two settings by what they allow", () => {
    expect(
      sameAccess(
        access("allow", "ask", { a: "allow", b: "block" }),
        access("allow", "ask", { b: "block", a: "allow" }),
      ),
    ).toBe(true);
    expect(
      sameAccess(access("allow", "ask"), access("allow", "ask", { a: "ask" })),
    ).toBe(false);
  });
});

describe("a tool rule the tool list does not show", () => {
  // TEST_SCENARIO: the tool list failed to load and the owner allowed slack_send_message from the CLI; the gateway lets the post through, so the summary must not say read only and must warn.
  it("counts an own rule when no tool is listed", () => {
    expect(
      accessSummary(
        access("allow", "block", { slack_send_message: "allow" }),
        null,
      ),
    ).toEqual({
      text: "Read only, except 1 writes without asking",
      tone: "writes",
    });
    expect(
      accessSummary(
        access("allow", "block", { slack_send_message: "ask" }),
        null,
      ),
    ).toEqual({ text: "Read only, except asks before 1 tool", tone: "asks" });
  });

  // TEST_SCENARIO: a tool the server dropped from its list keeps its own rule at the gateway, so it counts as a tool that posts or changes and is an exception of that group.
  it("counts an own rule on a tool the list does not name", () => {
    const dropped = access("allow", "block", { slack_delete_message: "allow" });
    expect(accessSummary(dropped, SLACK_TOOLS)).toEqual({
      text: "1 writes without asking · 7 blocked",
      tone: "writes",
    });
    expect(exceptionsOf(dropped, "write", SLACK_TOOLS)).toEqual([
      { name: "slack_delete_message", rule: "allow" },
    ]);
    expect(
      toolsOfGroup(dropped, SLACK_TOOLS, "write").filter((t) => !t.listed),
    ).toEqual([{ name: "slack_delete_message", listed: false }]);
    expect(toolsOfGroup(dropped, null, "write")).toEqual([
      { name: "slack_delete_message", listed: false },
    ]);
    expect(toolsOfGroup(dropped, SLACK_TOOLS, "read")).toHaveLength(4);
  });
});

describe("a tool named like a property every object has", () => {
  const tools: readonly ConnectionTool[] = [
    { name: "toString", readOnly: true },
    { name: "constructor", readOnly: false },
  ];

  // TEST_SCENARIO: a tool named toString or constructor has no rule of its own unless the owner gave it one, so it follows its group and the page does not read a built-in function as a rule.
  it("follows its group", () => {
    const plain = access("allow", "ask");
    expect(toolRuleOf(plain, "toString", tools)).toBe("allow");
    expect(toolRuleOf(plain, "constructor", tools)).toBe("ask");
    expect(exceptionsOf(plain, "write", tools)).toEqual([]);
    expect(accessSummary(plain, tools)).toEqual({
      text: "Asks before writing",
      tone: "asks",
    });
    expect(sameAccess(plain, access("allow", "ask"))).toBe(true);
    const own = withToolRule(plain, "constructor", "block", tools);
    expect(toolRuleOf(own, "constructor", tools)).toBe("block");
    expect(withoutException(own, "constructor").overrides).toEqual({});
  });
});
