// @vitest-environment happy-dom
// TEST_OVERVIEW: Where an MCP connection's tool access shows, per Agent, with the `mcp-tool-approval` feature on. On an Agent's Connections the rows stay as they are, the line under the name says this Agent's access, Tool access opens the dialog for this Agent, and "Writes without asking" marks a grant that lets a tool write without asking. On the Connections page the row is the account only, with no mode and no connection-wide Tool access; "Used by N agents" opens a list inside the row with each Agent's access and its own Tool access, the Agents that write without asking first, six at first and the rest behind "Show N more", and the row counts the Agents that write without asking. With the feature off the Slack Account keeps its read only / "Can post as me" row and the names popover. Every tool rule counts, also one on a tool the tool list does not name. The platform connection's row instead says whether the Agent acts as the owner or as itself, and offers the owner Access to change it, with the feature on or off.
import type { ConnectionView, GrantToolAccess, ToolRule } from "api-server-api";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GrantDetails } from "../../modules/connections/components/default-accounts-callout.js";
import type { ConnectionHolder } from "../../modules/connections/hooks/use-connection-holders.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const flags = vi.hoisted(() => ({ "mcp-tool-approval": true }));
const server = vi.hoisted(() => ({ saved: [] as unknown[] }));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: flags }),
}));
vi.mock("../../modules/connections/components/connection-icon.js", () => ({
  ConnectionIcon: () => null,
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
    mutate: () => {},
  }),
  useSetGrantScope: () => ({
    isPending: false,
    error: null,
    mutateAsync: async (vars: unknown) => {
      server.saved.push(vars);
    },
  }),
}));
vi.mock(
  "../../modules/connections/hooks/use-connection-maintenance.js",
  () => ({
    useConnectionMaintenance: () => ({
      rowActions: () => undefined,
      updating: null,
      closeUpdate: () => {},
    }),
  }),
);

const { GrantedConnectionsPanel } =
  await import("../../modules/sandboxes/components/granted-connections-panel.js");
const { ConnectionRowCard } =
  await import("../../modules/connections/components/connection-row-card.js");

const SLACK = {
  id: "conn-slack",
  ownerId: "me",
  name: "slack-account",
  templateId: "slack",
  category: "app",
  authKind: "oauth",
  status: "active",
  contributions: [],
  hosts: [],
  accountLabel: "Tomas (apoco)",
  toolAccess: {
    mode: "read-only",
    modes: ["allow-all", "read-only", "needs-approval"],
    defaultMode: "read-only",
    tools: [
      { name: "slack_read_channel", readOnly: true },
      { name: "slack_send_message", readOnly: false },
      { name: "slack_add_reaction", readOnly: false },
    ],
    listedAt: null,
    listError: null,
  },
} as ConnectionView;

const access = (
  read: ToolRule,
  write: ToolRule,
  overrides: Record<string, ToolRule> = {},
): GrantToolAccess => ({ read, write, overrides });

let host: HTMLDivElement;
let root: Root;

const byTestId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function render(node: ReactNode) {
  act(() => root.render(node));
}

beforeEach(() => {
  flags["mcp-tool-approval"] = true;
  server.saved = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("an Agent's Connections with the feature on", () => {
  const panel = (toolAccess: GrantToolAccess | undefined, owner = true) =>
    createElement(GrantedConnectionsPanel, {
      groups: [
        {
          provider: { id: "slack", title: "Slack", iconSlug: "slack" },
          connections: [SLACK],
        },
      ] as never,
      granted: [SLACK],
      templateById: new Map(),
      onToggleGrant: () => {},
      onOpenCatalog: () => {},
      grants: new Map<string, GrantDetails>([
        [
          SLACK.id,
          {
            grantedAt: "2026-11-24T00:00:00Z",
            preferred: false,
            ...(toolAccess && { toolAccess }),
          },
        ],
      ]),
      ...(owner && {
        toolAccessFor: { id: "agent-standup", name: "Standup writer" },
      }),
    });

  // TEST_SCENARIO: the row keeps its account line and adds this Agent's access to it; a read only grant carries no mark and the connection-wide mode line is gone.
  it("says this Agent's access under the name", () => {
    render(panel(access("allow", "block")));
    expect(
      byTestId(`catalog-connection-account-${SLACK.id}`)!.textContent,
    ).toBe("Acts as Tomas (apoco) · Read only");
    expect(byTestId(`grant-writes-mark-${SLACK.id}`)).toBeNull();
    expect(byTestId(`catalog-narrow-${SLACK.id}`)).toBeNull();
  });

  // TEST_SCENARIO: a grant that lets a tool that does not read run without asking is marked on the row.
  it("marks a grant that writes without asking", () => {
    render(panel(access("allow", "ask", { slack_add_reaction: "allow" })));
    expect(byTestId(`grant-writes-mark-${SLACK.id}`)!.textContent).toBe(
      "Writes without asking",
    );
    expect(byTestId(`connection-scope-${SLACK.id}`)!.textContent).toBe(
      "Asks before 1 tool · 1 writes without asking",
    );
  });

  // TEST_SCENARIO: Tool access on the row opens the dialog for this Agent, and its save names this Agent and this connection only.
  it("opens Tool access for this Agent", async () => {
    render(panel(access("allow", "block")));
    act(() => byTestId(`grant-tool-access-${SLACK.id}`)!.click());
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      "slack-account · for Standup writer",
    );
    act(() => byTestId("tool-group-write-rule-ask")!.click());
    await act(async () => byTestId("grant-tool-access-submit")!.click());
    expect(server.saved).toEqual([
      {
        agentId: "agent-standup",
        connectionId: SLACK.id,
        access: access("allow", "ask"),
      },
    ]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  // TEST_SCENARIO: a viewer who may not set tool access sees the access line but no Tool access, and a grant with no tool access of its own, as for a connection the gateway does not read, shows none.
  it("shows Tool access only where it can be set", () => {
    render(panel(access("allow", "block"), false));
    expect(byTestId(`connection-scope-${SLACK.id}`)!.textContent).toBe(
      "Read only",
    );
    expect(byTestId(`grant-tool-access-${SLACK.id}`)).toBeNull();

    render(panel(undefined));
    expect(byTestId(`connection-scope-${SLACK.id}`)).toBeNull();
    expect(byTestId(`grant-tool-access-${SLACK.id}`)).toBeNull();
  });

  // TEST_SCENARIO: with the feature off the row is as before: the Slack Account's read only line and no Tool access per Agent.
  it("stays as before with the feature off", () => {
    flags["mcp-tool-approval"] = false;
    render(panel(access("allow", "allow")));
    expect(byTestId(`connection-scope-${SLACK.id}`)!.textContent).toBe(
      "Read only: searches and reads as you, posts nothing",
    );
    expect(byTestId(`grant-tool-access-${SLACK.id}`)).toBeNull();
    expect(byTestId(`grant-writes-mark-${SLACK.id}`)).toBeNull();
  });
});

describe("a connection's row on the Connections page", () => {
  const NAMES = [
    "Researcher",
    "Standup writer",
    "Release notes",
    "Inbox triage",
    "Docs gardener",
    "Support digest",
    "Changelog writer",
    "Meeting prep",
    "Recruiting helper",
    "Bug sorter",
    "Sales brief",
    "On-call buddy",
  ];
  const writers = new Set(["Inbox triage", "Bug sorter"]);
  const askers = new Set(["Standup writer", "Support digest"]);
  const holders: ConnectionHolder[] = NAMES.map((name, i) => ({
    id: `agent-${i}`,
    name,
    toolAccess: access(
      "allow",
      writers.has(name) ? "allow" : askers.has(name) ? "ask" : "block",
    ),
  }));

  const row = (connection: ConnectionView = SLACK) =>
    createElement(ConnectionRowCard, {
      connection,
      template: undefined,
      usedBy: holders,
      maintenance: { onEditScope: () => {} },
    });

  const agentLines = () =>
    [
      ...byTestId(`connection-used-by-${SLACK.id}-agents`)!.querySelectorAll(
        "li",
      ),
    ].map((li) => li.firstElementChild!.textContent);

  // TEST_SCENARIO: the row is the account only: no mode in the line, no connection-wide Tool access, and the Agents are behind "Used by", with a mark that counts the ones that write without asking.
  it("drops the connection-wide mode and counts the Agents that write", () => {
    render(
      row({
        ...SLACK,
        toolAccess: { ...SLACK.toolAccess!, mode: "allow-all" },
      }),
    );
    expect(
      byTestId(`catalog-connection-account-${SLACK.id}`)!.textContent,
    ).toBe("Acts as Tomas (apoco)");
    expect(byTestId(`catalog-narrow-${SLACK.id}`)).toBeNull();
    expect(byTestId(`connection-full-access-${SLACK.id}`)).toBeNull();
    expect(byTestId(`connection-writes-mark-${SLACK.id}`)!.textContent).toBe(
      "2 agents write without asking",
    );
    const toggle = byTestId(`connection-used-by-${SLACK.id}`)!;
    expect(toggle.textContent).toBe("Used by 12 agents");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(byTestId(`connection-used-by-${SLACK.id}-agents`)).toBeNull();
  });

  // TEST_SCENARIO: the list opens inside the row, the Agents that write without asking first and then the ones that ask, six at first, and "Show 6 more" shows all twelve.
  it("lists twelve Agents inside the row, riskiest first", () => {
    render(row());
    act(() => byTestId(`connection-used-by-${SLACK.id}`)!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(agentLines()).toEqual([
      "Inbox triage",
      "Bug sorter",
      "Standup writer",
      "Support digest",
      "Researcher",
      "Release notes",
    ]);
    expect(
      byTestId(`connection-agent-${SLACK.id}-agent-3-access`)!.textContent,
    ).toBe("Allows everything");
    expect(
      byTestId(`connection-agent-${SLACK.id}-agent-1-access`)!.textContent,
    ).toBe("Asks before writing");

    const more = byTestId(`connection-used-by-${SLACK.id}-more`)!;
    expect(more.textContent).toBe("Show 6 more");
    act(() => more.click());
    expect(agentLines()).toHaveLength(12);
    expect(more.textContent).toBe("Show fewer");
  });

  // TEST_SCENARIO: each Agent's Tool access opens the dialog for that Agent, and its save changes that Agent's grant only.
  it("opens Tool access for one Agent of the list", async () => {
    render(row());
    act(() => byTestId(`connection-used-by-${SLACK.id}`)!.click());
    act(() =>
      byTestId(`connection-agent-${SLACK.id}-agent-1-tool-access`)!.click(),
    );
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      "slack-account · for Standup writer",
    );
    act(() => byTestId("tool-rule-slack_add_reaction-rule-block")!.click());
    await act(async () => byTestId("grant-tool-access-submit")!.click());
    expect(server.saved).toEqual([
      {
        agentId: "agent-1",
        connectionId: SLACK.id,
        access: access("allow", "ask", { slack_add_reaction: "block" }),
      },
    ]);
  });

  // TEST_SCENARIO: the tool list failed to load and the owner allowed slack_send_message for one Agent from the CLI; that Agent's line warns and the row counts it, since the gateway lets the post through.
  it("counts a tool rule the tool list does not name", () => {
    const unread = {
      ...SLACK,
      toolAccess: { ...SLACK.toolAccess!, tools: null },
    } as ConnectionView;
    render(
      createElement(ConnectionRowCard, {
        connection: unread,
        template: undefined,
        usedBy: [
          {
            id: "agent-0",
            name: "Researcher",
            toolAccess: access("allow", "block", {
              slack_send_message: "allow",
            }),
          },
          {
            id: "agent-1",
            name: "Standup writer",
            toolAccess: access("allow", "block"),
          },
        ],
      }),
    );
    expect(byTestId(`connection-writes-mark-${SLACK.id}`)!.textContent).toBe(
      "1 agent writes without asking",
    );
    act(() => byTestId(`connection-used-by-${SLACK.id}`)!.click());
    const researcher = byTestId(`connection-agent-${SLACK.id}-agent-0-access`)!;
    expect(researcher.textContent).toBe(
      "Read only, except 1 writes without asking",
    );
    expect(researcher.dataset.tone).toBe("writes");
    expect(
      byTestId(`connection-agent-${SLACK.id}-agent-1-access`)!.textContent,
    ).toBe("Read only");
  });

  // TEST_SCENARIO: with the feature off the row keeps the Slack Account's read only line and the popover of names, with no list inside the row.
  it("stays as before with the feature off", () => {
    flags["mcp-tool-approval"] = false;
    render(row());
    expect(byTestId(`connection-scope-${SLACK.id}`)!.textContent).toBe(
      "Read only: searches and reads as you, posts nothing",
    );
    expect(byTestId(`connection-writes-mark-${SLACK.id}`)).toBeNull();
    const usedBy = byTestId(`connection-used-by-${SLACK.id}`)!;
    expect(usedBy.textContent).toBe("Used by 12 agents");
    expect(usedBy.getAttribute("aria-haspopup")).toBe("dialog");
    act(() => usedBy.click());
    expect(byTestId(`connection-used-by-${SLACK.id}-agents`)).toBeNull();
    expect(
      byTestId(`connection-used-by-${SLACK.id}-names`)!.textContent,
    ).toContain("Researcher");
  });
});

describe("an Agent's platform connection", () => {
  const DAM = {
    ...SLACK,
    id: "conn-dam",
    name: "platform",
    templateId: "dam",
    authKind: "header",
    accountLabel: undefined,
    toolAccess: undefined,
  } as unknown as ConnectionView;

  const panel = (actsAsItself: boolean, owner = true) =>
    createElement(GrantedConnectionsPanel, {
      groups: [
        {
          provider: { id: "dam", title: "Platform", iconSlug: "dam" },
          connections: [DAM],
        },
      ] as never,
      granted: [DAM],
      templateById: new Map(),
      onToggleGrant: () => {},
      onOpenCatalog: () => {},
      grants: new Map<string, GrantDetails>([
        [
          DAM.id,
          {
            grantedAt: "2026-11-28T00:00:00Z",
            preferred: false,
            ...(actsAsItself && {
              scope: { kind: "platform", reach: "own" } as const,
            }),
          },
        ],
      ]),
      ...(owner && {
        toolAccessFor: { id: "agent-standup", name: "Standup writer" },
      }),
    });

  // TEST_SCENARIO: a grant with no scope of its own reaches the platform with the owner's key, so the row says it acts as the owner, in the warning colour, and the owner can change it.
  it("says it acts as you, and offers Access to the owner", () => {
    render(panel(false));
    const line = byTestId(`catalog-connection-account-${DAM.id}`)!;
    expect(line.textContent).toMatch(/^Acts as you on /);
    expect(line.className).toContain("text-warning-fg");
    expect(byTestId(`grant-scope-${DAM.id}`)!.textContent).toBe("Access");
    expect(byTestId(`grant-tool-access-${DAM.id}`)).toBeNull();
  });

  // TEST_SCENARIO: with its own scope the Agent reaches the platform with its own key, so the row says it acts as itself and drops the warning colour.
  it("says it acts as itself once it has its own scope", () => {
    render(panel(true));
    const line = byTestId(`catalog-connection-account-${DAM.id}`)!;
    expect(line.textContent).toMatch(/^Acts as itself on /);
    expect(line.className).not.toContain("text-warning-fg");
  });

  // TEST_SCENARIO: the mcp-tool-approval feature decides tool access, not this: with it off the row still says how the Agent reaches the platform and still offers Access.
  it("offers Access with the tool access feature off", () => {
    flags["mcp-tool-approval"] = false;
    render(panel(false));
    expect(byTestId(`grant-scope-${DAM.id}`)).not.toBeNull();
  });

  // TEST_SCENARIO: a viewer who is not the owner reads the line but gets no Access, since only the owner may change it.
  it("shows the line without Access to anyone but the owner", () => {
    render(panel(true, false));
    expect(
      byTestId(`catalog-connection-account-${DAM.id}`)!.textContent,
    ).toMatch(/^Acts as itself on /);
    expect(byTestId(`grant-scope-${DAM.id}`)).toBeNull();
  });

  // TEST_SCENARIO: Access opens the dialog for this Agent; choosing to act as itself and saving sends this Agent's scope on this connection only.
  it("sets the Agent to act as itself", async () => {
    render(panel(false));
    act(() => byTestId(`grant-scope-${DAM.id}`)!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("platform · for Standup writer");
    expect(byTestId("grant-scope-submit")!.hasAttribute("disabled")).toBe(true);
    act(() => byTestId("grant-scope-itself")!.click());
    await act(async () => byTestId("grant-scope-submit")!.click());
    expect(server.saved).toEqual([
      {
        agentId: "agent-standup",
        connectionId: DAM.id,
        scope: { kind: "platform", reach: "own" },
      },
    ]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  // TEST_SCENARIO: choosing the owner again clears the scope; the dialog says the Agent's own key is revoked on save, since it is.
  it("gives an Agent that acts as itself the owner's access again", async () => {
    render(panel(true));
    act(() => byTestId(`grant-scope-${DAM.id}`)!.click());
    act(() => byTestId("grant-scope-owner")!.click());
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      "The agent's own key is revoked when you save.",
    );
    await act(async () => byTestId("grant-scope-submit")!.click());
    expect(server.saved).toEqual([
      { agentId: "agent-standup", connectionId: DAM.id, scope: null },
    ]);
  });
});
