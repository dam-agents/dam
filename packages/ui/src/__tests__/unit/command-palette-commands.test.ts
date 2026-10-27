// TEST_OVERVIEW: The command palette lists, for what the app holds now, the pages, settings tabs, approvals and each agent's sessions, configuration sections and management tasks, each named "agent <name>: …" and allowed by the person's permissions on that agent; it leaves out a command that would go where the person already is.
import {
  AGENT_PERMISSIONS,
  type AgentPermission,
  SessionMode,
} from "api-server-api";
import { describe, expect, it, vi } from "vitest";

import { buildCommands } from "../../modules/command-palette/lib/commands.js";
import type {
  PaletteActions,
  PaletteInput,
} from "../../modules/command-palette/lib/palette-command.js";
import type { AgentView } from "../../types.js";

const owned = (id: string, name: string, over: Partial<AgentView> = {}) =>
  ({
    id,
    name,
    avatar: null,
    state: "running",
    disabled: false,
    overBudget: false,
    requireConnectionAddress: true,
    access: { role: "owner", editors: [], permissions: [...AGENT_PERMISSIONS] },
    ...over,
  }) as unknown as AgentView;

const shared = (id: string, name: string, permissions: AgentPermission[]) =>
  owned(id, name, {
    access: { role: "editor", ownerEmail: "o@x", editors: [], permissions },
  });

const alice = owned("alice", "Alice");
const bob = owned("bob", "Bob");

function input(over: Partial<PaletteInput> = {}): PaletteInput {
  return {
    route: {
      view: "home",
      agentId: null,
      section: null,
      sessionId: null,
      settingsTab: null,
    },
    agents: [alice, bob],
    ownAgents: [alice, bob],
    restarting: new Map(),
    sessions: [
      {
        agentId: "alice",
        sessionId: "s1",
        title: "Fix login",
        mode: SessionMode.Chat,
        activityAt: 2,
      },
      {
        agentId: "alice",
        sessionId: "s2",
        title: null,
        mode: SessionMode.Chat,
        activityAt: 1,
      },
      {
        agentId: "bob",
        sessionId: "s3",
        title: "Report",
        mode: SessionMode.Chat,
        activityAt: 3,
      },
    ],
    openSession: null,
    artifacts: [{ id: "a1", title: "Dashboard", agentId: "alice" }],
    kits: [],
    settingsTabs: [
      { value: "account", label: "Account" },
      { value: "providers", label: "Providers" },
    ],
    sections: [
      { section: "setup", title: "General" },
      { section: "providers", title: "Providers" },
      { section: "people", title: "People" },
    ],
    channels: {},
    browserOpen: null,
    changesOpen: null,
    theme: "system",
    showSleeping: false,
    approvalsOpen: false,
    checklist: null,
    pendingApprovals: [],
    brandShort: "dam",
    ...over,
  };
}

const actions = () =>
  new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
    get: (spies, key: string) => (spies[key] ??= vi.fn()),
  }) as unknown as PaletteActions & Record<string, ReturnType<typeof vi.fn>>;

const titles = (i: PaletteInput, act = actions()) =>
  buildCommands(i, act).map((c) => `${c.prefix}${c.label}`);

describe("agent commands", () => {
  // TEST_SCENARIO: on Alice's Providers page, Alice's Providers command is gone (she is there) and Bob's carries the same action key the cross-agent boost reads.
  it("leaves out the open section and keys the same section of other agents", () => {
    const i = input({
      route: {
        view: "sandbox-home",
        agentId: "alice",
        section: "providers",
        sessionId: null,
        settingsTab: null,
      },
    });
    const list = buildCommands(i, actions());
    const names = list.map((c) => `${c.prefix}${c.label}`);
    expect(names).not.toContain("agent Alice: configure Providers");
    expect(names).toContain("agent Alice: configure General");
    expect(list.find((c) => c.label === "configure Providers")).toMatchObject({
      agentId: "bob",
      action: "configure:providers",
    });
  });

  // TEST_SCENARIO: a session row names its agent and its title, or the short id when it has no title; the session open in the chat is not offered again, but can be renamed and deleted.
  it("lists sessions and the open session's tasks", () => {
    const names = titles(
      input({
        route: {
          view: "chat",
          agentId: "alice",
          section: null,
          sessionId: "s1",
          settingsTab: null,
        },
        openSession: {
          sessionId: "s1",
          agentId: "alice",
          title: "Fix login",
        } as never,
        browserOpen: false,
        changesOpen: true,
      }),
    );
    expect(names).not.toContain("agent Alice: session “Fix login”");
    expect(names).toContain("agent Alice: session “(no title · s2)”");
    expect(names).toContain("agent Bob: session “Report”");
    expect(names).toContain("agent Alice: rename session “Fix login”");
    expect(names).toContain("agent Alice: delete session “Fix login”");
    expect(names).toContain("agent Alice: toggle browser");
    expect(names).toContain("agent Alice: toggle changes");
    expect(names).not.toContain("agent Bob: toggle browser");
  });

  // TEST_SCENARIO: an editor who may not delete, restart or open sessions sees none of those, sees no locked section, and may leave the agent.
  it("follows the person's permissions on a shared agent", () => {
    const carol = shared("carol", "Carol", ["view", "connections"]);
    const names = titles(input({ agents: [carol], ownAgents: [] }));
    const carols = names.filter((n) => n.startsWith("agent Carol: "));
    expect(carols).toEqual([
      "agent Carol: configure Providers",
      "agent Carol: leave",
    ]);
  });

  // TEST_SCENARIO: a sleeping agent offers wake and no restart; a disabled one offers enable.
  it("offers lifecycle tasks by the agent's state", () => {
    const sleepy = owned("z", "Zed", { state: "hibernated" });
    const off = owned("o", "Off", { state: "hibernated", disabled: true });
    const names = titles(
      input({ agents: [sleepy, off], ownAgents: [sleepy, off] }),
    );
    expect(names).toContain("agent Zed: wake");
    expect(names).not.toContain("agent Zed: restart");
    expect(names).toContain("agent Zed: disable");
    expect(names).toContain("agent Off: enable");
    expect(names).not.toContain("agent Off: wake");
  });

  // TEST_SCENARIO: right after a restart or wake is clicked the server still reports the old state, so neither is offered again until the app stops showing the agent as restarting.
  it("offers no second restart or wake while one is settling", () => {
    const sleepy = owned("z", "Zed", { state: "hibernated" });
    const names = titles(
      input({
        agents: [alice, sleepy],
        ownAgents: [alice, sleepy],
        restarting: new Map([
          ["alice", {}],
          ["z", {}],
        ]),
      }),
    );
    expect(names).not.toContain("agent Alice: restart");
    expect(names).not.toContain("agent Zed: wake");
  });

  // TEST_SCENARIO: delete is marked destructive and only runs through the action that holds the confirmation.
  it("routes delete through the confirming action", () => {
    const act = actions();
    const del = buildCommands(input(), act).find(
      (c) => c.id === "agent:alice:delete",
    )!;
    expect(del.destructive).toBe(true);
    expect(del.perform.kind).toBe("run");
    if (del.perform.kind === "run") del.perform.run();
    expect(act.deleteAgent).toHaveBeenCalledWith(alice);
  });

  // TEST_SCENARIO: rename asks for the new name in the palette, starting from the current one.
  it("asks for the new name", () => {
    const act = actions();
    const rename = buildCommands(input(), act).find(
      (c) => c.id === "agent:bob:rename",
    )!;
    expect(rename.perform).toMatchObject({ kind: "input", initial: "Bob" });
    if (rename.perform.kind === "input") rename.perform.submit("Robert");
    expect(act.renameAgent).toHaveBeenCalledWith(bob, "Robert");
  });
});

describe("global commands", () => {
  // TEST_SCENARIO: the page, settings tab and theme the person is on are not offered.
  it("leaves out where the person already is", () => {
    const names = titles(
      input({
        route: {
          view: "settings",
          agentId: null,
          section: null,
          sessionId: null,
          settingsTab: "providers",
        },
        theme: "dark",
      }),
    );
    expect(names).toContain("go to Home");
    expect(names).toContain("settings: Account");
    expect(names).not.toContain("settings: Providers");
    expect(names).not.toContain("theme: dark");
    expect(names).toContain("theme: light");
  });

  // TEST_SCENARIO: deny all appears only while requests wait, and the approvals toggle names what it will do.
  it("offers deny all only with waiting requests", () => {
    expect(titles(input())).not.toContain("approvals: deny all");
    const pending = [{ id: "p", status: "pending", type: "egress" }] as never;
    const names = titles(
      input({ pendingApprovals: pending, approvalsOpen: true }),
    );
    expect(names).toContain("approvals: deny all");
    expect(names).toContain("approvals: close panel");
  });

  // TEST_SCENARIO: while the Get started checklist has tasks left, the palette opens it from its pill, or closes it when open; once every task is done it offers nothing.
  it("opens and closes the Get started checklist", () => {
    const act = actions();
    const find = (checklist: PaletteInput["checklist"]) =>
      buildCommands(input({ checklist }), act).find(
        (c) => c.id === "get-started:checklist",
      );
    expect(find(null)).toBeUndefined();
    const open = find("closed")!;
    expect(`${open.prefix}${open.label}`).toBe("get started: open checklist");
    if (open.perform.kind === "run") open.perform.run();
    expect(act.setChecklistOpen).toHaveBeenLastCalledWith(true);
    const close = find("open")!;
    expect(close.label).toBe("close checklist");
    if (close.perform.kind === "run") close.perform.run();
    expect(act.setChecklistOpen).toHaveBeenLastCalledWith(false);
  });

  // TEST_SCENARIO: an artifact carries its agent, so the artifacts of the open agent rank closer.
  it("ties artifacts to their agent", () => {
    const artifact = buildCommands(input(), actions()).find(
      (c) => c.id === "artifact:a1",
    );
    expect(artifact).toMatchObject({
      label: "artifact “Dashboard”",
      agentId: "alice",
    });
  });
});
