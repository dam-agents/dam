// TEST_OVERVIEW: The Agent's own configuration changes reach the chat: a create, a one-time schedule or a toggle is read from the platform MCP tool's result, and an installed skill from its text answer. A tool call that failed or is still running names no item, so the chat shows no card for it.
import { expect, it } from "vitest";

import { agentChangeOf } from "../../modules/sessions/lib/agent-change.js";
import type { ToolChip } from "../../types.js";

function chip(title: string, output: string, status = "completed"): ToolChip {
  return {
    kind: "tool",
    toolCallId: "t1",
    title,
    status,
    content: [{ type: "content", text: output }],
  };
}

// TEST_SCENARIO: the Agent creates a schedule through the platform's own MCP server; the chat can name it and open it because the tool's result carries the id and the name.
it("reads a created schedule from the tool result", () => {
  const change = agentChangeOf(
    chip(
      "mcp__platform-outbound__create_schedule",
      JSON.stringify({ id: "sched-1", name: "Daily triage" }),
    ),
  );
  expect(change).toEqual({
    tab: "automations",
    kind: "schedule",
    verb: "created",
    id: "sched-1",
    name: "Daily triage",
  });
});

// TEST_SCENARIO: a one-time schedule and a toggle are changes too, and the toggle reads as a change rather than a creation.
it("reads a one-time schedule and a toggle", () => {
  expect(
    agentChangeOf(
      chip(
        "mcp__platform-outbound__schedule_once",
        JSON.stringify({ id: "sched-2", name: "Check the build" }),
      ),
    )?.verb,
  ).toBe("created");
  expect(
    agentChangeOf(
      chip(
        "mcp__platform-outbound__toggle_schedule",
        JSON.stringify({
          id: "sched-3",
          name: "Weekly review",
          enabled: false,
        }),
      ),
    )?.verb,
  ).toBe("changed");
});

// TEST_SCENARIO: an installed skill answers in prose, not JSON, and its name is in that answer.
it("reads an installed skill from its answer", () => {
  expect(
    agentChangeOf(
      chip(
        "mcp__platform-outbound__install_skill",
        "Installed release-notes @ 4f2a1c3b. Agent now has 2 skill(s).",
      ),
    ),
  ).toEqual({
    tab: "skills",
    kind: "skill",
    verb: "created",
    id: "release-notes",
    name: "release-notes",
  });
});

// TEST_SCENARIO: nothing stands behind a running, failed or unrelated tool call, so the chat shows no card for it.
it("has no card without an item the chat can open", () => {
  const created = JSON.stringify({ id: "sched-1", name: "Daily triage" });
  expect(
    agentChangeOf(
      chip("mcp__platform-outbound__create_schedule", created, "in_progress"),
    ),
  ).toBe(null);
  expect(
    agentChangeOf(
      chip("mcp__platform-outbound__create_schedule", created, "failed"),
    ),
  ).toBe(null);
  expect(
    agentChangeOf(chip("mcp__platform-outbound__create_schedule", "not json")),
  ).toBe(null);
  expect(
    agentChangeOf(chip("mcp__platform-outbound__list_schedules", "[]")),
  ).toBe(null);
  expect(agentChangeOf(chip("Bash", created))).toBe(null);
});
