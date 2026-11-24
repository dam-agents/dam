// @vitest-environment happy-dom
// TEST_OVERVIEW: The Tool access dialog for one Agent on one MCP connection. Its subtitle names the connection and the Agent. It shows two groups, "Tools that read" and "Tools that post or change", each with an Allow / Ask / Block control and a count; a group opens to its tools, each with the same control, and a tool that differs from its group is an exception with a reset that a closed group names. One line says a tool the server adds later follows the second group. Save sends the Agent's whole access for that one grant, and the saved access shows again when the dialog opens on it. A tool with its own rule that the tool list does not name shows in the second group too, marked as not in the tool list, with its control and a reset, because the gateway applies its rule.
import type { ConnectionView, GrantToolAccess, ToolRule } from "api-server-api";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const server = vi.hoisted(() => ({
  saved: [] as unknown[],
  refreshed: [] as unknown[],
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../modules/connections/api/mutations.js", () => ({
  useSetGrantToolAccess: () => ({
    isPending: false,
    error: null,
    mutateAsync: async (vars: unknown) => {
      server.saved.push(vars);
    },
  }),
  useRefreshConnectionTools: () => ({
    isPending: false,
    error: null,
    data: undefined,
    mutate: (vars: unknown) => server.refreshed.push(vars),
  }),
}));

const { GrantToolAccessDialog } =
  await import("../../modules/connections/components/grant-tool-access-dialog.js");

const READS = ["slack_search_public", "slack_read_channel"];
const WRITES = [
  "slack_send_message",
  "slack_add_reaction",
  "slack_create_canvas",
];

const SLACK = {
  id: "conn-slack",
  name: "slack-account",
  templateId: "slack",
  authKind: "oauth",
  status: "active",
  toolAccess: {
    mode: "read-only",
    modes: ["allow-all", "read-only", "needs-approval"],
    defaultMode: "read-only",
    tools: [
      ...READS.map((name) => ({ name, readOnly: true })),
      ...WRITES.map((name) => ({ name, readOnly: false })),
    ],
    listedAt: new Date().toISOString(),
    listError: null,
  },
} as unknown as ConnectionView;

const READ_ONLY: GrantToolAccess = {
  read: "allow",
  write: "block",
  overrides: {},
};

let host: HTMLDivElement;
let root: Root;
let closed: number;

const byTestId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function open(access: GrantToolAccess, connection: ConnectionView = SLACK) {
  act(() =>
    root.render(
      createElement(GrantToolAccessDialog, {
        agent: { id: "agent-standup", name: "Standup writer" },
        connection,
        access,
        onClose: () => closed++,
      }),
    ),
  );
}

function pick(control: string, rule: ToolRule) {
  act(() => byTestId(`${control}-${rule}`)!.click());
}

function save() {
  return act(async () => byTestId("grant-tool-access-submit")!.click());
}

beforeEach(() => {
  server.saved = [];
  server.refreshed = [];
  closed = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the Tool access dialog", () => {
  // TEST_SCENARIO: the dialog is about one Agent on one connection, so its subtitle names both; the two groups carry their counts, the tools that post or change open at once, and the line about tools added later names that group.
  it("opens for one Agent with the two groups", () => {
    open(READ_ONLY);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Tool access");
    expect(dialog.textContent).toContain("slack-account · for Standup writer");
    expect(byTestId("tool-group-read")!.textContent).toContain(
      "Tools that read2",
    );
    expect(byTestId("tool-group-write")!.textContent).toContain(
      "Tools that post or change3",
    );
    expect(byTestId("tool-rule-slack_read_channel")).toBeNull();
    expect(byTestId("tool-rule-slack_send_message")).not.toBeNull();
    expect(dialog.textContent).toContain(
      "A tool the server adds later follows “Tools that post or change”.",
    );
    expect(byTestId("grant-tool-access-summary")!.textContent).toBe(
      "Read only",
    );
    expect(dialog.textContent).toContain("Tools listed");
  });

  // TEST_SCENARIO: nothing changed yet, so Save waits; a group control changes the whole group and the summary at once.
  it("changes a whole group", () => {
    open(READ_ONLY);
    expect(byTestId("grant-tool-access-submit")!.hasAttribute("disabled")).toBe(
      true,
    );
    pick("tool-group-write-rule", "ask");
    expect(byTestId("grant-tool-access-summary")!.textContent).toBe(
      "Asks before writing",
    );
    expect(
      byTestId("tool-rule-slack_send_message-rule-ask")!.getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    expect(byTestId("grant-tool-access-submit")!.hasAttribute("disabled")).toBe(
      false,
    );
  });

  // TEST_SCENARIO: one tool set apart from its group is marked as an exception with a reset; the closed group still names it, and reset makes it follow its group again.
  it("sets one tool as an exception", () => {
    open(READ_ONLY);
    pick("tool-rule-slack_add_reaction-rule", "allow");
    const row = byTestId("tool-rule-slack_add_reaction")!;
    expect(row.dataset.exception).toBe("true");
    expect(row.textContent).toContain("exception");
    expect(byTestId("grant-tool-access-summary")!.textContent).toBe(
      "1 writes without asking · 2 blocked",
    );

    act(() => byTestId("tool-group-write-toggle")!.click());
    expect(byTestId("tool-rule-slack_add_reaction")).toBeNull();
    expect(byTestId("tool-group-write-exceptions")!.textContent).toBe(
      "1 exception: slack_add_reaction allowed",
    );

    act(() => byTestId("tool-group-write-toggle")!.click());
    act(() => byTestId("tool-rule-slack_add_reaction-reset")!.click());
    expect(byTestId("tool-rule-slack_add_reaction")!.dataset.exception).toBe(
      undefined,
    );
    expect(byTestId("tool-group-write-exceptions")).toBeNull();
  });

  // TEST_SCENARIO: Save sends this Agent's whole access for this one connection, a group rule and an exception together, and closes; opened again on what was saved, the dialog shows the same group rule and the same exception.
  it("saves a group rule and an exception, and shows them again", async () => {
    open(READ_ONLY);
    pick("tool-group-write-rule", "ask");
    pick("tool-rule-slack_create_canvas-rule", "block");
    await save();

    const saved = {
      read: "allow",
      write: "ask",
      overrides: { slack_create_canvas: "block" },
    } satisfies GrantToolAccess;
    expect(server.saved).toEqual([
      {
        agentId: "agent-standup",
        connectionId: "conn-slack",
        access: saved,
      },
    ]);
    expect(closed).toBe(1);

    act(() => root.unmount());
    root = createRoot(host);
    open(saved);
    expect(
      byTestId("tool-group-write-rule-ask")!.getAttribute("aria-checked"),
    ).toBe("true");
    expect(byTestId("tool-rule-slack_create_canvas")!.dataset.exception).toBe(
      "true",
    );
    expect(byTestId("grant-tool-access-summary")!.textContent).toBe(
      "Asks before 2 tools · 1 blocked",
    );
  });

  // TEST_SCENARIO: Refresh reads the connection's tool list again.
  it("refreshes the tool list", () => {
    open(READ_ONLY);
    act(() => byTestId("tool-access-refresh")!.click());
    expect(server.refreshed).toEqual([{ id: "conn-slack" }]);
  });

  // TEST_SCENARIO: the tool list failed to load and the owner allowed slack_send_message from the CLI; the dialog shows that tool under "Tools that post or change" as not in the tool list, the summary warns, and Reset takes the rule away.
  it("shows a tool rule the tool list does not name", async () => {
    const unread = {
      ...SLACK,
      toolAccess: { ...SLACK.toolAccess!, tools: null, listedAt: null },
    } as ConnectionView;
    open({ ...READ_ONLY, overrides: { slack_send_message: "allow" } }, unread);
    const row = byTestId("tool-rule-slack_send_message")!;
    expect(row.closest('[data-testid="tool-group-write"]')).not.toBeNull();
    expect(byTestId("tool-rule-slack_send_message-unlisted")!.textContent).toBe(
      "not in the tool list",
    );
    expect(byTestId("tool-group-write")!.textContent).toContain(
      "Tools that post or change1",
    );
    expect(
      byTestId("tool-rule-slack_send_message-rule-allow")!.getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    expect(byTestId("grant-tool-access-summary")!.textContent).toBe(
      "Read only, except 1 writes without asking",
    );
    expect(byTestId("grant-tool-access-summary")!.dataset.tone).toBe("writes");

    act(() => byTestId("tool-rule-slack_send_message-reset")!.click());
    expect(byTestId("tool-rule-slack_send_message")).toBeNull();
    expect(byTestId("grant-tool-access-summary")!.textContent).toBe(
      "Read only",
    );
    await save();
    expect(server.saved).toEqual([
      {
        agentId: "agent-standup",
        connectionId: "conn-slack",
        access: READ_ONLY,
      },
    ]);
  });
});
