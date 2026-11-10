// @vitest-environment happy-dom
// TEST_OVERVIEW: The + button at the start of the composer opens a menu so a person reaches what the Agent works with without leaving the chat. Its first level offers Attach file and the Agent's Skills, Schedules and Connections, each with how many are on. Each of those opens a panel listing the Agent's items with the switch the platform already offers: a skill installs or comes off, a recurring schedule pauses or resumes, a Connection is added to the Agent or removed, after the shared-agent confirm when one applies. Each panel's add opens the existing create dialog after the menu closes, Manage opens the same section of the Agent's settings, and for skills and schedules "Or, describe to create" leaves a starting prompt in the composer, focused, and sends nothing. A viewer who may not change a list sees it without switches or add.
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
  toggleGrant: vi.fn(),
  confirmShare: vi.fn(async () => true),
  grantedIds: new Set<string>(),
  managesConnections: true,
  rivalOf: null as string | null,
  schedules: [] as unknown[],
}));

const SKILLS = [
  { source: "src-1", name: "pr-review", description: "Review a pull request" },
  { source: "src-1", name: "triage", description: "Triage new issues" },
];

vi.mock("../../modules/agents/api/queries.js", () => ({
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
}));
vi.mock("../../modules/sandboxes/hooks/use-agent-connection-grants.js", () => ({
  useAgentConnectionGrants: () => ({
    connections: connections(),
    granted: connections().filter((c) => fake.grantedIds.has(c.id)),
    grantedIds: fake.grantedIds,
    loaded: true,
    failed: false,
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
  ScheduleFormModal: (props: { agentId: string }) =>
    createElement("div", {
      "data-testid": "schedule-form",
      "data-agent": props.agentId,
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
  // TEST_SCENARIO: the + button opens the menu with Attach file first, then Skills, Schedules and Connections, each counting what the Agent has on: a paused schedule is not active while a one-time one still to come is, and a model provider Connection is not counted.
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
  // TEST_SCENARIO: each skill of a connected source has a switch that shows whether it is on the Agent, and a flip installs or removes it; a skill made in the Agent is listed with no switch.
  it("turns a source's skill on and off", () => {
    renderMenu();
    openPanel("Skills");
    expect(panel()!.textContent).toContain("team-skills");
    expect(panel()!.textContent).toContain("Created in this agent");
    expect(panel()!.textContent).toContain("my-notes");
    expect(switchNamed("my-notes skill")).toBeNull();
    expect(switchNamed("pr-review skill")!.getAttribute("aria-checked")).toBe(
      "true",
    );
    const triage = switchNamed("triage skill")!;
    expect(triage.getAttribute("aria-checked")).toBe("false");
    click(triage);
    expect(fake.toggleSkill).toHaveBeenCalledWith(SKILLS[1]);
  });

  // TEST_SCENARIO: an Agent that is not running cannot take a skill change, so the switches are off limits and the panel says to start it.
  it("holds the switches while the Agent cannot take a change", () => {
    fake.operable = false;
    renderMenu();
    openPanel("Skills");
    expect(switchNamed("triage skill")!.disabled).toBe(true);
    expect(panel()!.textContent).toContain("Start the agent");
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

  // TEST_SCENARIO: a viewer who may not change the Agent's skills or sources sees them with every switch held and no Add source.
  it("is read-only for a viewer without the skills permission", () => {
    fake.permissions = [];
    renderMenu();
    openPanel("Skills");
    expect(switchNamed("triage skill")!.disabled).toBe(true);
    expect(
      [...body().querySelectorAll("button")].some(
        (b) => b.textContent?.trim() === "Add source",
      ),
    ).toBe(false);
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

  // TEST_SCENARIO: a viewer who may not change schedules sees them with no switch and no Create schedule.
  it("is read-only for a viewer without the schedules permission", () => {
    fake.permissions = [];
    renderMenu();
    openPanel("Schedules");
    expect(switchNamed("Daily triage schedule enabled")).toBeNull();
    expect(panel()!.textContent).not.toContain("Create schedule");
  });
});

describe("the Connections panel", () => {
  // TEST_SCENARIO: the owner's Connections are listed by service with a switch showing whether the Agent holds each; a model provider is left out, since providers have their own settings.
  it("lists the owner's Connections with the Agent's grants", () => {
    renderMenu();
    openPanel("Connections");
    expect(panel()!.textContent).toContain("GitHub");
    expect(panel()!.textContent).toContain("Linear");
    expect(panel()!.textContent).not.toContain("Model provider");
    expect(
      switchNamed("GitHub as octo on this agent")!.getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      switchNamed("Linear on this agent")!.getAttribute("aria-checked"),
    ).toBe("false");
  });

  // TEST_SCENARIO: switching a Connection on asks the shared-agent confirm first and then adds it; switching one off removes it with no confirm.
  it("grants after the confirm and revokes at once", async () => {
    renderMenu();
    openPanel("Connections");
    click(switchNamed("Linear on this agent")!);
    await flush();
    expect(fake.confirmShare).toHaveBeenCalledTimes(1);
    expect(fake.toggleGrant).toHaveBeenCalledWith("c-lin", true);
    click(switchNamed("GitHub as octo on this agent")!);
    await flush();
    expect(fake.confirmShare).toHaveBeenCalledTimes(1);
    expect(fake.toggleGrant).toHaveBeenLastCalledWith("c-gh", false);
  });

  // TEST_SCENARIO: a declined confirm leaves the Connection off the Agent.
  it("does not grant when the confirm is declined", async () => {
    fake.confirmShare.mockImplementation(async () => false);
    renderMenu();
    openPanel("Connections");
    click(switchNamed("Linear on this agent")!);
    await flush();
    expect(fake.toggleGrant).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a Connection that would sign in to the same host as one the Agent holds cannot be switched on, and the row says why.
  it("holds a rival Connection off", () => {
    fake.rivalOf = "c-lin";
    renderMenu();
    openPanel("Connections");
    expect(switchNamed("Linear on this agent")!.disabled).toBe(true);
    expect(panel()!.textContent).toContain("Already signs in to github.com");
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

  // TEST_SCENARIO: a viewer who may not change the Agent's Connections sees them with no switch and no Add connection.
  it("is read-only for a viewer who may not change Connections", () => {
    fake.managesConnections = false;
    renderMenu();
    openPanel("Connections");
    expect(switchNamed("Linear on this agent")).toBeNull();
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
});
