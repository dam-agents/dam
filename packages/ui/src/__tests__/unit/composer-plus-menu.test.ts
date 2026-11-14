// @vitest-environment happy-dom
// TEST_OVERVIEW: The + button at the start of the composer opens a menu so a person reaches what the Agent works with without leaving the chat. Its first level offers Attach file and the Agent's Skills, Schedules and Connections, each with how many are on, with no icon or chevron. Each of those opens a panel listing the Agent's items with the switch the platform already offers: the Skills panel is the Agent's own skills surface, compact, a recurring schedule pauses or resumes, the Connections panel lists the Connections the Agent holds in one card per service, each with its menu, and Add connection opens the catalog to grant more. Each panel's add opens the existing create dialog after the menu closes, Manage opens the same section of the Agent's settings, and for skills and schedules "Or, describe to create" leaves a starting prompt in the composer, focused, and sends nothing. A viewer who may not change a list sees it without switches or add, and the Connections panel draws no switch until the Agent's grants have loaded.
import { PROVIDER_TEMPLATE_IDS } from "api-server-api";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Schedule } from "../../types.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const PROVIDER_TEMPLATE = [...PROVIDER_TEMPLATE_IDS][0]!;

const fake = vi.hoisted(() => ({
  permissions: [] as string[],
  operable: true,
  installed: new Set<string>(),
  toggleSkill: vi.fn(async () => {}),
  toggleSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  toggleGrant: vi.fn(),
  confirmShare: vi.fn(async () => true),
  grantedIds: new Set<string>(),
  managesConnections: true,
  grantsLoaded: true,
  grantsFailed: false,
  rivalOf: null as string | null,
  schedules: [] as unknown[],
}));

const SKILLS = [
  { source: "src-1", name: "pr-review", description: "Review a pull request" },
  { source: "src-1", name: "triage", description: "Triage new issues" },
];

vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentDisplayName: () => "Alpha",
  useAgent: (agentId: string | null) =>
    agentId
      ? {
          id: agentId,
          name: "Alpha",
          state: "running",
          access: {
            role: "owner",
            editors: [],
            permissions: fake.permissions,
          },
        }
      : null,
  useAgentConnections: () => ({
    data: {
      connections: [...fake.grantedIds].map((id) => ({
        connectionId: id,
        connection: connections().find((c) => c.id === id),
      })),
    },
  }),
}));
vi.mock("../../modules/agents/api/skills.js", () => ({
  useSkillsState: () => ({
    data: { installed: [...fake.installed].map((name) => ({ name })) },
  }),
}));
vi.mock("../../modules/agents/hooks/use-operable-state.js", () => ({
  useOperableState: () => ({ operable: fake.operable, comingUp: false }),
}));
vi.mock("../../modules/sandboxes/components/skills/skills-surface.js", () => ({
  SkillsSurface: (props: {
    agentId: string;
    readOnly: boolean;
    compact?: boolean;
    managesLibrary: boolean;
    hideSwitches?: boolean;
  }) =>
    createElement("div", {
      "data-testid": "skills-surface",
      "data-hide-switches": String(!!props.hideSwitches),
      "data-agent": props.agentId,
      "data-read-only": String(props.readOnly),
      "data-compact": String(!!props.compact),
      "data-manages": String(props.managesLibrary),
    }),
}));
vi.mock("../../modules/sandboxes/hooks/use-skills-surface.js", () => ({
  useSkillsSurface: () => ({
    sources: [{ id: "src-1", name: "team-skills" }],
    hiddenSources: [],
    sourcesLoaded: true,
    stateLoaded: true,
    loadingBySource: {},
    errorBySource: {},
    busyKey: null,
    mutationsDisabled: false,
    installedRef: (skill: { name: string }) =>
      fake.installed.has(skill.name) ? { name: skill.name } : undefined,
    toggle: fake.toggleSkill,
    setSourceHidden: vi.fn(),
    createSource: vi.fn(),
    createLocalSkills: vi.fn(),
  }),
}));
vi.mock("../../modules/sandboxes/hooks/use-skills-derivations.js", () => ({
  useSkillsDerivations: () => ({
    shownSources: [{ id: "src-1", name: "team-skills" }],
    listBySource: new Map([["src-1", SKILLS]]),
    shownCreatedHere: [{ name: "my-notes" }],
    shownBuiltIn: [],
  }),
}));
vi.mock("../../modules/schedules/api/queries.js", () => ({
  useSchedules: () => ({
    data: fake.schedules,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("../../modules/schedules/api/mutations.js", () => ({
  useToggleSchedule: () => ({ mutate: fake.toggleSchedule, isPending: false }),
  useDeleteSchedule: () => ({ mutate: fake.deleteSchedule, isPending: false }),
  useRunScheduleNow: () => ({ mutate: vi.fn(), isPending: false }),
  useResetScheduleSession: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../modules/schedules/hooks/use-schedule-edit-guard.js", () => ({
  useScheduleEditGuard: () => (_s: unknown, _n: unknown, onEdit: () => void) =>
    Promise.resolve(onEdit()),
}));
vi.mock("../../modules/sandboxes/hooks/use-agent-connection-grants.js", () => ({
  useAgentConnectionGrants: () => ({
    connections: connections(),
    granted: connections().filter((c) => fake.grantedIds.has(c.id)),
    grantedIds: fake.grantedIds,
    loaded: fake.grantsLoaded,
    failed: fake.grantsFailed,
    managesConnections: fake.managesConnections,
    sharing: { notice: null, confirm: fake.confirmShare },
    toggleGrant: fake.toggleGrant,
    revokeGrants: vi.fn(),
  }),
}));
vi.mock("../../modules/connections/hooks/use-catalog-groups.js", () => ({
  useCatalogGroups: (listed: { id: string; templateId: string }[]) => ({
    populated: [
      {
        provider: { id: "github", title: "GitHub" },
        connections: listed.filter((c) => c.templateId === "github"),
      },
      {
        provider: { id: "linear", title: "Linear" },
        connections: listed.filter((c) => c.templateId === "linear"),
      },
    ].filter((g) => g.connections.length > 0),
  }),
}));
vi.mock("../../modules/connections/components/connection-group.js", () => ({
  ConnectionGroup: (props: {
    group: { provider: { title: string }; connections: { id: string }[] };
    showCount?: boolean;
    grant?: (c: { id: string }) => { onToggle: (on: boolean) => void };
    maintenance?: (c: {
      id: string;
    }) => { onUpdateCredential?: () => void } | undefined;
  }) =>
    createElement(
      "section",
      {
        "data-testid": "connection-group",
        "data-provider": props.group.provider.title,
        "data-ids": props.group.connections.map((c) => c.id).join(","),
        "data-count": String(!!props.showCount),
        "data-menus": String(!!props.grant && !!props.maintenance),
      },
      props.grant &&
        props.group.connections.flatMap((c) => [
          createElement(
            "button",
            {
              key: c.id,
              type: "button",
              "aria-label": `Remove ${c.id}`,
              onClick: () => props.grant!(c).onToggle(false),
            },
            "remove",
          ),
          createElement(
            "button",
            {
              key: `${c.id}-update`,
              type: "button",
              "aria-label": `Update ${c.id}`,
              onClick: () => props.maintenance?.(c)?.onUpdateCredential?.(),
            },
            "update",
          ),
        ]),
    ),
}));
vi.mock(
  "../../modules/connections/components/connection-update-credential-dialog.js",
  () => ({
    ConnectionMaintenanceDialog: (props: {
      maintenance: { updating: { id: string } | null };
    }) =>
      props.maintenance.updating
        ? createElement("div", {
            "data-testid": "update-credential",
            "data-id": props.maintenance.updating.id,
          })
        : null,
  }),
);
vi.mock(
  "../../modules/connections/hooks/use-connection-maintenance.js",
  async () => {
    const { useState } = await import("react");
    return {
      useConnectionMaintenance: () => {
        const [updating, setUpdating] = useState<{ id: string } | null>(null);
        return {
          updating,
          closeUpdate: () => setUpdating(null),
          rowActions: (c: { id: string }) => ({
            onUpdateCredential: () => setUpdating(c),
          }),
        };
      },
    };
  },
);
vi.mock("../../modules/connections/lib/grant-rivals.js", () => ({
  grantRivalry: (candidate: { id: string }) =>
    candidate.id === fake.rivalOf
      ? { connection: candidate, rival: { name: "Work" }, host: "github.com" }
      : undefined,
  grantBlockedReason: () => "Already signs in to github.com",
}));
vi.mock(
  "../../modules/sandboxes/components/skills/add-skill-source-modal.js",
  () => ({
    AddSkillSourceModal: (props: { mode: string }) =>
      createElement("div", {
        "data-testid": "add-skill-source",
        "data-mode": props.mode,
      }),
  }),
);
vi.mock("../../modules/schedules/forms/schedule-form-modal.js", () => ({
  ScheduleFormModal: (props: { agentId: string; existing?: { id: string } }) =>
    createElement("div", {
      "data-testid": "schedule-form",
      "data-agent": props.agentId,
      "data-existing": props.existing?.id,
    }),
}));
vi.mock(
  "../../modules/connections/components/connection-catalog-modal.js",
  () => ({
    ConnectionCatalogModal: (props: {
      sandbox: { grantedIds: ReadonlySet<string> };
      oauthReturnView: string;
    }) =>
      createElement("div", {
        "data-testid": "connection-catalog",
        "data-granted": [...props.sandbox.grantedIds].join(","),
        "data-return": props.oauthReturnView,
      }),
  }),
);

function connections() {
  return [
    { id: "c-gh", name: "GitHub", accountLabel: "octo", templateId: "github" },
    { id: "c-lin", name: "Linear", templateId: "linear" },
    { id: "c-llm", name: "Model provider", templateId: PROVIDER_TEMPLATE },
  ];
}

function schedule(over: Partial<Schedule>): Schedule {
  return {
    id: "s",
    name: "Schedule",
    agentId: "agent-a",
    type: "cron",
    cron: "0 9 * * *",
    rrule: null,
    at: null,
    inSession: null,
    harness: null,
    model: null,
    settings: null,
    profile: null,
    migrationNote: null,
    sessionTitle: null,
    timezone: null,
    quietHours: [],
    task: null,
    precheck: null,
    enabled: true,
    createdBy: "user",
    status: null,
    ...over,
  };
}

const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { ComposerPlusMenu } =
  await import("../../modules/sessions/components/plus-menu/composer-plus-menu.js");
const { ChatInput } =
  await import("../../modules/sessions/components/chat-input.js");
const { useStore } = await import("../../store.js");
const { draftKey } = await import("../../modules/sessions/lib/draft-key.js");

let host: HTMLDivElement;
let root: Root;
let frames: FrameRequestCallback[] = [];
const onAttachFile = vi.fn();
const onDescribe = vi.fn();
const onManage = vi.fn();

function renderMenu() {
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ComposerPlusMenu, {
          agentId: "agent-a",
          disabled: false,
          onAttachFile,
          onDescribe,
          onManage,
        }),
      ),
    ),
  );
}

const body = () => document.body;
const trigger = () =>
  body().querySelector<HTMLButtonElement>(
    '[data-testid="composer-plus-menu"]',
  )!;
const root1 = () => body().querySelector('[data-testid="plus-menu-root"]');
const panel = () => body().querySelector('[data-testid="plus-menu-panel"]');
const byTestId = (id: string) =>
  body().querySelector<HTMLElement>(`[data-testid="${id}"]`);

function buttonReading(text: string) {
  const button = [...body().querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  expect(button, `a button reading ${text}`).toBeDefined();
  return button!;
}
function rowButton(label: string) {
  const button = [...body().querySelectorAll("button")].find((b) =>
    b.textContent?.startsWith(label),
  );
  expect(button, `a row reading ${label}`).toBeDefined();
  return button!;
}
const click = (el: HTMLElement) => act(() => el.click());
const switchNamed = (label: string) =>
  body().querySelector<HTMLButtonElement>(
    `[role="switch"][aria-label="${label}"]`,
  );

function openMenu() {
  act(() => {
    trigger().dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    trigger().click();
  });
}

function openPanel(label: string) {
  openMenu();
  click(rowButton(label));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  fake.permissions = ["skills", "skillSources", "schedules", "connections"];
  fake.operable = true;
  fake.installed = new Set(["pr-review"]);
  fake.grantedIds = new Set(["c-gh"]);
  fake.managesConnections = true;
  fake.grantsLoaded = true;
  fake.grantsFailed = false;
  fake.rivalOf = null;
  fake.confirmShare.mockImplementation(async () => true);
  fake.schedules = [
    schedule({ id: "s-daily", name: "Daily triage", enabled: true }),
    schedule({ id: "s-weekly", name: "Weekly report", enabled: false }),
    schedule({
      id: "s-once",
      name: "Remind me",
      type: "once",
      cron: null,
      at: "2026-12-01T09:00:00Z",
      status: {},
    }),
  ];
  for (const spy of [
    fake.toggleSkill,
    fake.toggleSchedule,
    fake.toggleGrant,
    fake.confirmShare,
    onAttachFile,
    onDescribe,
    onManage,
  ])
    spy.mockClear();
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("innerWidth", 1280);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

describe("the menu's first level", () => {
  // TEST_SCENARIO: the + button opens the menu with Attach file first, then Skills, Schedules and Connections, with no icon or chevron, as the design draws them, the three lists each counting what the Agent has on: a paused schedule is not active while a one-time one still to come is, and a model provider Connection is not counted.
  it("offers attach and the three lists with their counts", () => {
    renderMenu();
    expect(trigger().getAttribute("aria-label")).toBe("Add");
    expect(root1()).toBeNull();
    openMenu();
    const rows = [...root1()!.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(rows).toEqual([
      "Attach file",
      "Skills1 on",
      "Schedules2 active",
      "Connections1",
    ]);
    expect(root1()!.querySelectorAll("svg").length).toBe(0);
  });

  // TEST_SCENARIO: Attach file opens the file picker the composer always had and closes the menu.
  it("attaches a file", () => {
    renderMenu();
    openMenu();
    click(rowButton("Attach file"));
    expect(onAttachFile).toHaveBeenCalledTimes(1);
    expect(root1()).toBeNull();
  });

  // TEST_SCENARIO: a list's Back returns to the first level, and Manage opens that section of the Agent's settings and closes the menu.
  it("goes back from a panel and opens Manage", () => {
    renderMenu();
    openPanel("Schedules");
    click(body().querySelector<HTMLButtonElement>('[aria-label="Back"]')!);
    expect(root1()).not.toBeNull();
    click(rowButton("Schedules"));
    click(buttonReading("Manage"));
    expect(onManage).toHaveBeenCalledWith("schedules");
    expect(panel()).toBeNull();
  });
});

describe("the Skills panel", () => {
  // TEST_SCENARIO: the panel is the Agent's own skills surface in its compact form, as the design draws it — search, counts, the skills made in the Agent and a card per source with its switches — and it may change them while the Agent runs.
  it("shows the Agent's skills surface, compact", () => {
    renderMenu();
    openPanel("Skills");
    const surface = byTestId("skills-surface")!;
    expect(surface.dataset.agent).toBe("agent-a");
    expect(surface.dataset.compact).toBe("true");
    expect(surface.dataset.readOnly).toBe("false");
    expect(surface.dataset.manages).toBe("true");
  });

  // TEST_SCENARIO: an Agent that is not running cannot take a skill change, so the surface is read-only.
  it("holds the switches while the Agent cannot take a change", () => {
    fake.operable = false;
    renderMenu();
    openPanel("Skills");
    expect(byTestId("skills-surface")!.dataset.readOnly).toBe("true");
  });

  // TEST_SCENARIO: Add source closes the menu and opens the existing dialog that adds a GitHub skill source.
  it("opens the add-source dialog", () => {
    renderMenu();
    openPanel("Skills");
    click(buttonReading("Add source"));
    expect(panel()).toBeNull();
    expect(byTestId("add-skill-source")!.dataset.mode).toBe("github");
  });

  // TEST_SCENARIO: describing a skill closes the menu and hands the composer the starting prompt.
  it("describes a skill to the Agent", () => {
    renderMenu();
    openPanel("Skills");
    click(buttonReading("Or, describe to create"));
    expect(onDescribe).toHaveBeenCalledWith("Create a skill that...");
    expect(panel()).toBeNull();
  });

  // TEST_SCENARIO: a viewer who may not change the Agent's skills or sources gets the design's read-only state: the skills with no switches, no footer and no Manage.
  it("is read-only for a viewer without the skills permission", () => {
    fake.permissions = [];
    renderMenu();
    openPanel("Skills");
    expect(byTestId("skills-surface")!.dataset.hideSwitches).toBe("true");
    expect(byTestId("skills-surface")!.dataset.manages).toBe("false");
    const labels = [...body().querySelectorAll("button")].map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).not.toContain("Add source");
    expect(labels).not.toContain("Or, describe to create");
    expect(labels).not.toContain("Manage");
  });
});

describe("the Schedules panel", () => {
  // TEST_SCENARIO: a recurring schedule's switch pauses or resumes it, and a one-time schedule is listed without one.
  it("pauses and resumes a recurring schedule", () => {
    renderMenu();
    openPanel("Schedules");
    expect(panel()!.textContent).toContain("Remind me");
    expect(switchNamed("Remind me schedule enabled")).toBeNull();
    click(switchNamed("Daily triage schedule enabled")!);
    expect(fake.toggleSchedule).toHaveBeenCalledWith({
      id: "s-daily",
      enabled: false,
    });
    click(switchNamed("Weekly report schedule enabled")!);
    expect(fake.toggleSchedule).toHaveBeenLastCalledWith({
      id: "s-weekly",
      enabled: true,
    });
  });

  // TEST_SCENARIO: each schedule has the Schedules section's ⋮ menu; Edit schedule closes the + menu and opens that schedule in its editor outside it, so the editor is neither under the menu nor closed by a click in it.
  it("edits a schedule from its menu", async () => {
    renderMenu();
    openPanel("Schedules");
    const menus = [
      ...body().querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Schedule actions"]',
      ),
    ];
    expect(menus.length).toBe(3);
    act(() => {
      menus[0]!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    await flush();
    const items = [...body().querySelectorAll('[role="menuitem"]')].map(
      (el) => el.textContent,
    );
    expect(items).toEqual(["Run now", "Edit schedule", "Delete schedule"]);
    const edit = [
      ...body().querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((el) => el.textContent === "Edit schedule")!;
    act(() => edit.click());
    await flush();
    expect(panel()).toBeNull();
    const form = byTestId("schedule-form");
    expect(form).not.toBeNull();
    expect(form!.dataset.existing).toBe("s-daily");
  });

  // TEST_SCENARIO: Create schedule closes the menu and opens the schedule form for this Agent.
  it("opens the schedule form", () => {
    renderMenu();
    openPanel("Schedules");
    click(buttonReading("Create schedule"));
    expect(panel()).toBeNull();
    expect(byTestId("schedule-form")!.dataset.agent).toBe("agent-a");
  });

  // TEST_SCENARIO: describing a schedule hands the composer the design's starting prompt.
  it("describes a schedule to the Agent", () => {
    renderMenu();
    openPanel("Schedules");
    click(buttonReading("Or, describe to create"));
    expect(onDescribe).toHaveBeenCalledWith("Every morning at 9am...");
  });

  // TEST_SCENARIO: an Agent with no schedule says so and points at describing one.
  it("says when the Agent has none", () => {
    fake.schedules = [];
    renderMenu();
    openPanel("Schedules");
    expect(panel()!.textContent).toContain("No schedules yet.");
  });

  // TEST_SCENARIO: a viewer who may not change schedules sees them as the design's read-only state draws it: no switch and no footer.
  it("is read-only for a viewer without the schedules permission", () => {
    fake.permissions = [];
    renderMenu();
    openPanel("Schedules");
    expect(switchNamed("Daily triage schedule enabled")).toBeNull();
    expect(panel()!.textContent).not.toContain("Create schedule");
    expect(panel()!.textContent).not.toContain("Or, describe to create");
  });
});

describe("the Connections panel", () => {
  const groups = () =>
    [
      ...body().querySelectorAll<HTMLElement>(
        '[data-testid="connection-group"]',
      ),
    ].map((g) => ({
      provider: g.dataset.provider,
      ids: g.dataset.ids,
      count: g.dataset.count,
      menus: g.dataset.menus,
    }));

  // TEST_SCENARIO: the panel lists the Connections the Agent holds, as the design draws it, in one card per service with its count and each row's menu; a Connection it does not hold, and a model provider, are left out.
  it("lists the Agent's Connections in a card per service", () => {
    renderMenu();
    openPanel("Connections");
    expect(groups()).toEqual([
      { provider: "GitHub", ids: "c-gh", count: "true", menus: "true" },
    ]);
    expect(panel()!.textContent).not.toContain("Model provider");
  });

  // TEST_SCENARIO: removing a Connection from a card takes it off the Agent at once.
  it("removes a Connection from the Agent", () => {
    renderMenu();
    openPanel("Connections");
    click(
      body().querySelector<HTMLButtonElement>(
        'button[aria-label="Remove c-gh"]',
      )!,
    );
    expect(fake.toggleGrant).toHaveBeenCalledWith("c-gh", false);
  });

  // TEST_SCENARIO: a row's Update credential closes the + menu and opens the credential dialog outside it, so the dialog is neither under the menu nor closed by a click in it.
  it("updates a credential with the menu closed", () => {
    renderMenu();
    openPanel("Connections");
    click(
      body().querySelector<HTMLButtonElement>(
        'button[aria-label="Update c-gh"]',
      )!,
    );
    expect(panel()).toBeNull();
    expect(byTestId("update-credential")!.dataset.id).toBe("c-gh");
  });

  // TEST_SCENARIO: Add connection closes the menu and opens the catalog with the Agent's grants, returning to the chat after a sign-in.
  it("opens the catalog to add a Connection", () => {
    renderMenu();
    openPanel("Connections");
    click(buttonReading("Add connection"));
    expect(panel()).toBeNull();
    const catalog = byTestId("connection-catalog")!;
    expect(catalog.dataset.granted).toBe("c-gh");
    expect(catalog.dataset.return).toBe("/chat/agent-a");
  });

  // TEST_SCENARIO: the Agent's grants are still loading, so the panel says so and lists nothing, which would show the Agent holding none.
  it("lists nothing while the Agent's grants load", () => {
    fake.grantsLoaded = false;
    renderMenu();
    openPanel("Connections");
    expect(panel()!.textContent).toContain("Loading connections");
    expect(groups()).toEqual([]);
  });

  // TEST_SCENARIO: the read of the Agent's grants failed, so the panel says so and lists nothing.
  it("lists nothing when the Agent's grants could not load", () => {
    fake.grantsFailed = true;
    renderMenu();
    openPanel("Connections");
    expect(panel()!.textContent).toContain("Couldn't load connections");
    expect(groups()).toEqual([]);
  });

  // TEST_SCENARIO: a viewer who may not change the Agent's Connections sees the cards with no menu and no Add connection.
  it("is read-only for a viewer who may not change Connections", () => {
    fake.managesConnections = false;
    renderMenu();
    openPanel("Connections");
    expect(groups()[0]!.menus).toBe("false");
    expect(panel()!.textContent).not.toContain("Add connection");
  });
});

describe("describing from the composer", () => {
  // TEST_SCENARIO: in the chat's composer, a describe leaves the starting prompt as the new chat's draft with the caret at its end, focused, and sends nothing.
  it("puts the starting prompt in the composer", () => {
    useStore.setState({
      selectedAgent: "agent-a",
      sessionId: null,
      drafts: {},
      messages: [],
      reportedCommands: null,
    });
    const onSend = vi.fn();
    const textareaRef = createRef<HTMLTextAreaElement>();
    act(() =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(ChatInput, {
            textareaRef,
            busy: false,
            loadingSession: false,
            onSend,
            onStop: () => {},
          }),
        ),
      ),
    );
    openPanel("Schedules");
    click(buttonReading("Or, describe to create"));
    act(() => {
      for (const cb of frames.splice(0)) cb(0);
    });
    const text = "Every morning at 9am...";
    expect(useStore.getState().drafts[draftKey("agent-a", null)]?.text).toBe(
      text,
    );
    const textarea = host.querySelector("textarea")!;
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(text.length);
    expect(onSend).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the composer already holds a draft; a describe puts the starting prompt in its place, as the design does.
  it("puts the starting prompt in place of a draft", () => {
    useStore.setState({
      selectedAgent: "agent-a",
      sessionId: null,
      drafts: {},
      messages: [],
      reportedCommands: null,
    });
    useStore
      .getState()
      .setDraft(draftKey("agent-a", null), { text: "Check the build  " });
    const textareaRef = createRef<HTMLTextAreaElement>();
    act(() =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(ChatInput, {
            textareaRef,
            busy: false,
            loadingSession: false,
            onSend: () => {},
            onStop: () => {},
          }),
        ),
      ),
    );
    openPanel("Schedules");
    click(buttonReading("Or, describe to create"));
    expect(useStore.getState().drafts[draftKey("agent-a", null)]?.text).toBe(
      "Every morning at 9am...",
    );
  });
});
