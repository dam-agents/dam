// @vitest-environment happy-dom
// TEST_OVERVIEW: The owner finds Environments in the Artifacts list, as they find artifacts: an Environments group above the folders, with a row for each Environment that names it, says whether it runs and when it is deleted, names its agent where the list spans agents, and links each address in a new tab. In an agent's chat the list starts on that agent's Environments; a search narrows them by name; with none to show there is no group. An Environment's Share dialog says who opens it through its agent, counted and never listed, and edits only the people of that one Environment. The agent's page keeps only the agent's Environment members and links to the Artifacts list.
import type { EnvironmentView } from "api-server-api";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const state = vi.hoisted(() => ({
  agentMembers: [] as string[],
  role: "owner" as "owner" | "editor",
  saveMembers: [] as unknown[],
}));

vi.mock("../../modules/environments/api/mutations.js", () => ({
  useDeleteEnvironment: () => ({ mutate: vi.fn(), isPending: false }),
  useExtendEnvironment: () => ({ mutate: vi.fn(), isPending: false }),
  useSetEnvironmentMembers: () => ({
    mutate: (input: unknown) => state.saveMembers.push(input),
    isPending: false,
  }),
  useSetAgentEnvironmentMembers: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../modules/environments/api/queries.js", () => ({
  useAgentEnvironmentMembers: () => ({
    data: state.agentMembers,
    isError: false,
  }),
}));
vi.mock("../../modules/agents/api/queries.js", () => {
  const agents = [
    {
      id: "agent-dev",
      name: "dev",
      get access() {
        return {
          role: state.role,
          editors: ["ed@example.com"],
          permissions: [],
        };
      },
    },
    {
      id: "agent-qa",
      name: "qa",
      access: { role: "owner", editors: [], permissions: [] },
    },
  ];
  return {
    useAgentsList: () => agents,
    useAgent: (id: string) => agents.find((a) => a.id === id) ?? null,
  };
});
vi.mock("../../modules/agents/components/avatar/agent-avatar.js", () => ({
  AgentAvatar: () => null,
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({
      showConfirm: vi.fn(),
      selectAgent: vi.fn(),
      setView: vi.fn(),
      navigateToSandboxHome: vi.fn(),
    }),
}));

const { visibleEnvironments, environmentStateLabel, sharedThroughAgent } =
  await import("../../modules/environments/lib/environment-list.js");
const { EnvironmentsGroup } =
  await import("../../modules/environments/components/environments-group.js");
const { EnvironmentShareDialog } =
  await import("../../modules/environments/components/environment-share-dialog.js");
const { AgentEnvironmentsSection } =
  await import("../../modules/environments/components/agent-environment-members.js");

function environment(
  name: string,
  owningAgentId: string,
  extra: Partial<EnvironmentView> = {},
): EnvironmentView {
  return {
    id: `agent-${name}`,
    owningAgentId,
    name,
    endpoints: [
      { name: "app", port: 4444, url: `https://app-${name}.env.example.com` },
      { name: "auth", port: 8080, url: `https://auth-${name}.env.example.com` },
    ],
    members: [],
    agentMemberCount: 0,
    expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    idleTimeoutMin: 60,
    createdAt: new Date().toISOString(),
    state: "running",
    ...extra,
  };
}

const demo = environment("demo-1", "agent-dev");
const other = environment("other", "agent-qa", { state: "hibernated" });

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(TooltipProvider, null, element)),
    "text/html",
  );

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

// UNIT_BOUNDARY_DESCRIPTION: a dialog mounted in the page, since a Modal portals out and the server renderer draws no portal.
function mount(element: ReactElement): Document {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root!.render(createElement(TooltipProvider, null, element)));
  return document;
}

function renderGroup(environments: EnvironmentView[], showAgent = true) {
  return html(
    createElement(EnvironmentsGroup, {
      environments,
      showAgent,
      collapsed: false,
      onToggle: vi.fn(),
    }),
  );
}

describe("Environments in the Artifacts list", () => {
  // TEST_SCENARIO: AC-1 — each Environment is a row of the Environments group, with its name, whether it runs, its agent, and a link to its first address that opens a new tab.
  it("shows a row per Environment with its state, agent and link", () => {
    const doc = renderGroup([demo, other]);

    const rows = [...doc.querySelectorAll('[data-testid="environment-row"]')];
    expect(rows.map((r) => r.getAttribute("data-environment"))).toEqual([
      "demo-1",
      "other",
    ]);
    expect(
      rows.map(
        (r) =>
          r.querySelector('[data-testid="environment-state"]')?.textContent,
      ),
    ).toEqual(["Running", "Sleeping"]);
    expect(rows[0]!.textContent).toContain("dev");
    expect(rows[1]!.textContent).toContain("qa");
    const links = [
      ...rows[0]!.querySelectorAll('[data-testid="environment-link"]'),
    ];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://app-demo-1.env.example.com",
    ]);
    for (const a of links) expect(a.getAttribute("target")).toBe("_blank");
  });

  // TEST_SCENARIO: #6182 — a row with four addresses shows one link inline, so the name, state and deletion chip keep their room and clip rather than run under the links; the row's menu opens every address in a new tab.
  it("keeps a four-address row readable and opens each address from its menu", () => {
    const names = ["app", "keycloak", "share", "content"];
    const busy = environment("busy", "agent-dev", {
      endpoints: names.map((name, i) => ({
        name,
        port: 4000 + i,
        url: `https://${name}-busy.env.example.com`,
      })),
    });
    const doc = mount(
      createElement(EnvironmentsGroup, {
        environments: [busy],
        showAgent: true,
        collapsed: false,
        onToggle: vi.fn(),
      }),
    );
    const row = doc.querySelector('[data-testid="environment-row"]')!;

    const inline = [
      ...row.querySelectorAll('[data-testid="environment-link"]'),
    ];
    expect(inline.map((a) => a.textContent)).toEqual(["app"]);
    const label = row.querySelector(
      '[data-testid="environment-state"]',
    )!.parentElement!;
    expect(label.className).toContain("overflow-hidden");
    expect(label.textContent).toContain("busy");

    act(() => {
      row
        .querySelector('[data-testid="environment-actions"]')!
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    const opened = [
      ...doc.querySelectorAll<HTMLAnchorElement>(
        '[data-testid="environment-menu-link"]',
      ),
    ];
    expect(opened.map((a) => [a.textContent, a.getAttribute("href")])).toEqual(
      names.map((name) => [
        `Open ${name}`,
        `https://${name}-busy.env.example.com`,
      ]),
    );
    for (const a of opened) {
      expect(a.getAttribute("role")).toBe("menuitem");
      expect(a.getAttribute("target")).toBe("_blank");
    }
  });

  // TEST_SCENARIO: AC-2 — in one agent's chat, scoped to that agent, the group shows only its Environments, and names no agent.
  it("shows only the chat's agent's Environments in its chat", () => {
    const shown = visibleEnvironments([demo, other], {
      agentId: "agent-dev",
      term: "",
    });
    expect(shown.map((e) => e.name)).toEqual(["demo-1"]);
    expect(
      renderGroup(shown, false).querySelector('[aria-label="Open dev"]'),
    ).toBeNull();
  });

  // TEST_SCENARIO: AC-4 — a search finds Environments by name, as it finds artifacts by title.
  it("finds Environments by name", () => {
    expect(
      visibleEnvironments([demo, other], { agentId: null, term: "demo" }).map(
        (e) => e.name,
      ),
    ).toEqual(["demo-1"]);
  });

  // TEST_SCENARIO: AC-3 — with no Environment to show, the list draws no group at all.
  it("has no group when there are none", () => {
    expect(visibleEnvironments([], { agentId: null, term: "" })).toEqual([]);
  });

  // TEST_SCENARIO: a machine starting, sleeping or in any other state reads as one of four words, so the badge never shows a raw state.
  it("names the state in plain words", () => {
    expect(
      ["running", "starting", "hibernated", "error"].map(environmentStateLabel),
    ).toEqual(["Running", "Starting", "Sleeping", "Not running"]);
  });
});

describe("an Environment's Share dialog", () => {
  // TEST_SCENARIO: AC-8 — with two Environment members on the agent's page and one editor, the dialog says the Environment is open to the agent's editors and 2 people from the agent, and lists no person of its own.
  it("summarises who is in through the agent and lists only its own people", () => {
    const doc = mount(
      createElement(EnvironmentShareDialog, {
        environment: { ...demo, agentMemberCount: 2 },
        onClose: vi.fn(),
      }),
    );

    expect(
      doc.querySelector('[data-testid="environment-shared-through-agent"]')
        ?.textContent,
    ).toContain("Open to you, dev's editors and 2 people from dev.");
    expect(doc.querySelector('[data-testid="viewer-list"]')).toBeNull();
    expect(doc.body.textContent).not.toContain("ed@example.com");
  });

  // TEST_SCENARIO: the people the owner added to this one Environment are listed one by one, beside the count from the agent.
  it("lists the Environment's own members", () => {
    const doc = mount(
      createElement(EnvironmentShareDialog, {
        environment: { ...demo, members: ["guest@example.com"] },
        onClose: vi.fn(),
      }),
    );

    expect(
      doc.querySelector('[data-testid="viewer-list"]')?.textContent,
    ).toContain("guest@example.com");
  });

  // TEST_SCENARIO: a member added elsewhere while the dialog is open shows up in it at the next poll, and Save stays off, so a Save cannot drop that member unseen.
  it("follows the members the list polls while it is open", () => {
    const onClose = vi.fn();
    const doc = mount(
      createElement(EnvironmentShareDialog, { environment: demo, onClose }),
    );
    act(() =>
      root!.render(
        createElement(
          TooltipProvider,
          null,
          createElement(EnvironmentShareDialog, {
            environment: { ...demo, members: ["late@example.com"] },
            onClose,
          }),
        ),
      ),
    );

    expect(
      doc.querySelector('[data-testid="viewer-list"]')?.textContent,
    ).toContain("late@example.com");
    const save = [...doc.querySelectorAll("button")].find(
      (b) => b.textContent === "Save",
    );
    expect(save?.disabled).toBe(true);
  });

  // TEST_SCENARIO: the owner removes a member while someone else adds another; Save sends the polled list with the removal applied, so the person added elsewhere stays.
  it("keeps a member added elsewhere through the owner's Save", () => {
    state.saveMembers = [];
    const onClose = vi.fn();
    const render = (members: string[]) =>
      createElement(
        TooltipProvider,
        null,
        createElement(EnvironmentShareDialog, {
          environment: { ...demo, members },
          onClose,
        }),
      );
    const doc = mount(
      createElement(EnvironmentShareDialog, {
        environment: { ...demo, members: ["old@example.com"] },
        onClose,
      }),
    );
    act(() =>
      (
        doc.querySelector(
          '[aria-label="Remove old@example.com"]',
        ) as HTMLButtonElement
      ).click(),
    );
    act(() => root!.render(render(["old@example.com", "late@example.com"])));
    act(() =>
      [...doc.querySelectorAll("button")]
        .find((b) => b.textContent === "Save")!
        .click(),
    );

    expect(state.saveMembers).toEqual([
      { id: demo.id, emails: ["late@example.com"] },
    ]);
  });

  // TEST_SCENARIO: the summary names only the parts that open it, joined as a sentence.
  it("words the summary for each mix of editors and members", () => {
    const say = (editorCount: number, agentMemberCount: number) =>
      sharedThroughAgent({ agentName: "dev", editorCount, agentMemberCount });
    expect(say(0, 0)).toBe("Open to you.");
    expect(say(1, 0)).toBe("Open to you and dev's editors.");
    expect(say(0, 1)).toBe("Open to you and 1 person from dev.");
  });
});

describe("the agent's page", () => {
  // TEST_SCENARIO: AC-5 — the agent's page shows its Environment members and a link to the Artifacts list, and no row for an Environment.
  it("keeps only the agent's members and links to Artifacts", () => {
    state.agentMembers = ["reviewer@example.com", "qa@example.com"];
    const doc = html(
      createElement(AgentEnvironmentsSection, {
        agentId: "agent-dev",
        header: () => null,
      }),
    );

    expect(doc.querySelector('[data-testid="viewer-list"]')?.textContent).toBe(
      "reviewer@example.comqa@example.com",
    );
    expect(doc.body.textContent).toContain("2 / 100 people on the list");
    expect(
      doc.querySelector('[data-testid="environments-in-artifacts"]')
        ?.textContent,
    ).toContain("Artifacts");
    expect(doc.querySelector('[data-testid="environment-row"]')).toBeNull();
  });

  // TEST_SCENARIO: an editor has no Artifacts list of the owner's, so the section says the owner manages each Environment instead of linking to an empty list.
  it("tells an editor who manages the Environments", () => {
    state.role = "editor";
    const doc = html(
      createElement(AgentEnvironmentsSection, {
        agentId: "agent-dev",
        header: () => null,
      }),
    );
    state.role = "owner";

    expect(
      doc.querySelector('[data-testid="environments-in-artifacts"]'),
    ).toBeNull();
    expect(
      doc.querySelector('[data-testid="environments-with-owner"]')?.textContent,
    ).toContain("owner");
  });
});
