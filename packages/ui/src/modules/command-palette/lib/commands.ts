import {
  Add,
  AddComment,
  Asleep,
  Awake,
  Book,
  Branch,
  Chat,
  Copy,
  DataEnrichmentAdd,
  Edit,
  Exit,
  Gift,
  Globe,
  Home,
  Light,
  LogoSlack,
  Logout,
  Misuse,
  Notification,
  Power,
  Restart,
  Screen,
  Settings,
  Terminal,
  Tools,
  TrashCan,
  View as ViewIcon,
  ViewOff,
} from "@carbon/icons-react";
import type { ApprovalView, SessionView } from "api-server-api";
import type { ComponentType } from "react";

import { TelegramIcon } from "@/components/brand-icons";

import type { AgentView } from "../../../types.js";
import { holds, isLockedSection } from "../../agents/lib/agent-permissions.js";
import { ArtifactIcon } from "../../artifacts/lib/artifact-icon.js";
import type {
  SandboxSection,
  SettingsTab,
  View,
} from "../../platform/lib/routes.js";
import type { Theme } from "../../platform/store/theme.js";
import type { BindMessenger } from "../../sandboxes/components/channels/messenger-instructions.js";
import { cliAgentRef } from "../../sandboxes/lib/cli-agent-ref.js";
import { sessionTitleLabel } from "../../sessions/lib/session-title.js";
import type { IndexedArtifact, IndexedSession } from "./palette-storage.js";
import { type Rankable, RANKING } from "./ranking.js";

const PRIOR = RANKING.PRIOR;

export type PalettePerform =
  | { kind: "run"; run: () => unknown }
  | {
      kind: "input";
      label: string;
      initial: string;
      submit: (value: string) => unknown;
    };

export interface PaletteCommand extends Rankable {
  prefix: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  destructive: boolean;
  perform: PalettePerform;
}

export interface PaletteRoute {
  view: View;
  agentId: string | null;
  section: SandboxSection | null;
  sessionId: string | null;
  settingsTab: SettingsTab | null;
}

export interface PaletteInput {
  route: PaletteRoute;
  agents: readonly AgentView[];
  ownAgents: readonly AgentView[];
  restarting: ReadonlyMap<string, unknown>;
  sessions: readonly IndexedSession[];
  openSession: SessionView | null;
  artifacts: readonly IndexedArtifact[];
  kits: readonly { catalog: string; id: string; name: string }[];
  settingsTabs: readonly { value: SettingsTab; label: string }[];
  sections: readonly { section: SandboxSection; title: string }[];
  channels: { slack?: boolean; telegram?: boolean };
  browserOpen: boolean | null;
  changesOpen: boolean | null;
  theme: Theme;
  showSleeping: boolean;
  approvalsOpen: boolean;
  pendingApprovals: readonly ApprovalView[];
  brandShort: string;
}

export interface PaletteActions {
  goTo: (view: "home" | "artifacts" | "starter-kits") => void;
  openDocs: () => void;
  createAgent: () => void;
  browseKits: () => void;
  openKit: (catalog: string, id: string) => void;
  bind: (messenger: BindMessenger) => void;
  setShowSleeping: (show: boolean) => void;
  openSettings: (tab: SettingsTab) => void;
  setTheme: (theme: Theme) => void;
  logOut: () => void;
  setApprovalsOpen: (open: boolean) => void;
  denyAll: (approvals: readonly ApprovalView[]) => void;
  newSession: (agentId: string) => void;
  newTerminal: (agentId: string) => void;
  openSession: (session: IndexedSession) => void;
  configure: (agentId: string, section: SandboxSection) => void;
  toggleBrowser: (agentId: string, open: boolean) => void;
  toggleChanges: (agentId: string, open: boolean) => void;
  renameAgent: (agent: AgentView, name: string) => unknown;
  wake: (agentId: string) => void;
  restart: (agent: AgentView) => void;
  toggleDisabled: (agent: AgentView) => void;
  deleteAgent: (agent: AgentView) => void;
  leave: (agent: AgentView) => void;
  copy: (text: string, what: string) => void;
  renameSession: (agentId: string, session: SessionView) => void;
  deleteSession: (agentId: string, session: SessionView) => void;
  openArtifact: (id: string) => void;
}

interface CommandSpec {
  id: string;
  prefix?: string;
  label: string;
  keywords?: readonly string[];
  icon: PaletteCommand["icon"];
  prior: number;
  agentId?: string | undefined;
  action?: string;
  activityAt?: number;
  destructive?: boolean;
  run?: () => unknown;
  input?: Extract<PalettePerform, { kind: "input" }>;
}

function command({
  prefix = "",
  keywords = [],
  destructive = false,
  run,
  input,
  ...spec
}: CommandSpec): PaletteCommand {
  return {
    ...spec,
    prefix,
    destructive,
    text: [`${prefix}${spec.label}`, ...keywords].join(" "),
    perform: input ?? { kind: "run", run: run ?? (() => undefined) },
  };
}

const THEMES: readonly { theme: Theme; icon: PaletteCommand["icon"] }[] = [
  { theme: "light", icon: Light },
  { theme: "dark", icon: Asleep },
  { theme: "system", icon: Screen },
];

const MINOR_SETTINGS: ReadonlySet<SettingsTab> = new Set([
  "slack-workspaces",
  "analytics",
  "operator",
  "features",
  "about",
]);

function globalCommands(
  input: PaletteInput,
  act: PaletteActions,
): PaletteCommand[] {
  const { view } = input.route;
  const pages = [
    { view: "home", label: "go to Home", icon: Home, prior: PRIOR.navigate },
    {
      view: "artifacts",
      label: "go to Artifacts",
      icon: ArtifactIcon,
      prior: PRIOR.navigate,
    },
    {
      view: "starter-kits",
      label: "go to Starter kits",
      icon: Gift,
      prior: PRIOR.configure,
    },
  ] as const;
  return [
    ...pages
      .filter((page) => page.view !== view)
      .map((page) =>
        command({
          id: `go:${page.view}`,
          label: page.label,
          icon: page.icon,
          prior: page.prior,
          run: () => act.goTo(page.view),
        }),
      ),
    command({
      id: "go:docs",
      label: "open documentation",
      keywords: ["help"],
      icon: Book,
      prior: PRIOR.docs,
      run: act.openDocs,
    }),
    command({
      id: "agent:new",
      prefix: "agent: ",
      label: "new",
      keywords: ["create"],
      icon: Add,
      prior: PRIOR.createAgent,
      run: act.createAgent,
    }),
    command({
      id: "agent:new-from-kit",
      prefix: "agent: ",
      label: "new from starter kit",
      keywords: ["create"],
      icon: DataEnrichmentAdd,
      prior: PRIOR.browseKits,
      run: act.browseKits,
    }),
    ...input.kits.map((kit) =>
      command({
        id: `kit:${kit.catalog}/${kit.id}`,
        prefix: "starter kit: ",
        label: kit.name,
        icon: Gift,
        prior: PRIOR.openKit,
        run: () => act.openKit(kit.catalog, kit.id),
      }),
    ),
    command({
      id: "sidebar:sleeping",
      prefix: "sidebar: ",
      label: input.showSleeping
        ? "hide sleeping agents"
        : "show sleeping agents",
      keywords: ["hibernating"],
      icon: input.showSleeping ? ViewOff : ViewIcon,
      prior: PRIOR.rare,
      run: () => act.setShowSleeping(!input.showSleeping),
    }),
    ...(["slack", "telegram"] as const)
      .filter((messenger) => input.channels[messenger])
      .map((messenger) =>
        command({
          id: `channels:bind:${messenger}`,
          prefix: "channels: ",
          label:
            messenger === "slack"
              ? "add an agent to a Slack channel"
              : "add an agent to a Telegram chat",
          icon: messenger === "slack" ? LogoSlack : TelegramIcon,
          prior: PRIOR.rare,
          run: () => act.bind(messenger),
        }),
      ),
  ];
}

function settingsCommands(
  input: PaletteInput,
  act: PaletteActions,
): PaletteCommand[] {
  return [
    ...input.settingsTabs
      .filter((tab) => tab.value !== input.route.settingsTab)
      .map((tab) =>
        command({
          id: `settings:${tab.value}`,
          prefix: "settings: ",
          label: tab.label,
          icon: Settings,
          prior: MINOR_SETTINGS.has(tab.value)
            ? PRIOR.minorSettings
            : PRIOR.settings,
          run: () => act.openSettings(tab.value),
        }),
      ),
    ...THEMES.filter(({ theme }) => theme !== input.theme).map(
      ({ theme, icon }) =>
        command({
          id: `theme:${theme}`,
          prefix: "theme: ",
          label: theme,
          keywords: ["appearance"],
          icon,
          prior: PRIOR.theme,
          run: () => act.setTheme(theme),
        }),
    ),
    command({
      id: "account:log-out",
      prefix: "account: ",
      label: "log out",
      keywords: ["sign out"],
      icon: Logout,
      prior: PRIOR.logOut,
      run: act.logOut,
    }),
  ];
}

function approvalCommands(
  input: PaletteInput,
  act: PaletteActions,
): PaletteCommand[] {
  return [
    command({
      id: "approvals:panel",
      prefix: "approvals: ",
      label: input.approvalsOpen ? "close panel" : "open panel",
      icon: Notification,
      prior: PRIOR.approvalsPanel,
      run: () => act.setApprovalsOpen(!input.approvalsOpen),
    }),
    ...(input.pendingApprovals.length > 0
      ? [
          command({
            id: "approvals:deny-all",
            prefix: "approvals: ",
            label: "deny all",
            keywords: ["reject"],
            icon: Misuse,
            prior: PRIOR.denyAll,
            destructive: true,
            run: () => act.denyAll(input.pendingApprovals),
          }),
        ]
      : []),
  ];
}

function agentCommands(
  agent: AgentView,
  input: PaletteInput,
  act: PaletteActions,
  activityAt: number | undefined,
): PaletteCommand[] {
  const { route } = input;
  const here = route.agentId === agent.id;
  const inChat = here && route.view === "chat";
  const may = (permission: Parameters<typeof holds>[1]) =>
    holds(agent.access, permission);
  const of = (spec: Omit<CommandSpec, "prefix" | "agentId">) =>
    command({
      ...spec,
      id: `agent:${agent.id}:${spec.id}`,
      prefix: `agent ${agent.name}: `,
      agentId: agent.id,
    });
  const ref = cliAgentRef(agent, input.ownAgents);
  const settling = input.restarting.has(agent.id);
  const asleep =
    agent.state === "hibernated" &&
    !agent.disabled &&
    !agent.overBudget &&
    !settling;
  const session = inChat ? input.openSession : null;

  return [
    ...(may("sessions")
      ? [
          of({
            id: "new-session",
            label: "new session",
            keywords: ["chat"],
            icon: AddComment,
            prior: PRIOR.newSession,
            ...(activityAt !== undefined && { activityAt }),
            run: () => act.newSession(agent.id),
          }),
          ...input.sessions
            .filter(
              (s) =>
                s.agentId === agent.id &&
                !(inChat && s.sessionId === route.sessionId),
            )
            .map((s) =>
              command({
                id: `session:${agent.id}:${s.sessionId}`,
                prefix: `agent ${agent.name}: `,
                label: `session “${sessionTitleLabel(s)}”`,
                icon: Chat,
                prior: PRIOR.openSession,
                agentId: agent.id,
                activityAt: s.activityAt,
                run: () => act.openSession(s),
              }),
            ),
        ]
      : []),
    ...(may("terminal")
      ? [
          of({
            id: "new-terminal",
            label: "new terminal session",
            icon: Terminal,
            prior: PRIOR.terminal,
            run: () => act.newTerminal(agent.id),
          }),
          of({
            id: "copy-cli",
            label: "copy CLI chat command",
            icon: Copy,
            prior: PRIOR.copy,
            run: () =>
              act.copy(`${input.brandShort} chat ${ref}`, "CLI chat command"),
          }),
          of({
            id: "copy-ssh",
            label: "copy SSH command",
            icon: Copy,
            prior: PRIOR.copy,
            run: () =>
              act.copy(`${input.brandShort} ssh connect ${ref}`, "SSH command"),
          }),
        ]
      : []),
    ...input.sections
      .filter(
        ({ section }) =>
          !isLockedSection(agent.access, section) &&
          !(here && route.view === "sandbox-home" && route.section === section),
      )
      .map(({ section, title }) =>
        of({
          id: `configure:${section}`,
          label: `configure ${title}`,
          keywords: ["settings"],
          icon: Tools,
          prior: PRIOR.configure,
          action: `configure:${section}`,
          run: () => act.configure(agent.id, section),
        }),
      ),
    ...(inChat && input.browserOpen !== null
      ? [
          of({
            id: "toggle-browser",
            label: "toggle browser",
            icon: Globe,
            prior: PRIOR.toggle,
            run: () => act.toggleBrowser(agent.id, !input.browserOpen),
          }),
        ]
      : []),
    ...(inChat && input.changesOpen !== null
      ? [
          of({
            id: "toggle-changes",
            label: "toggle changes",
            keywords: ["diff"],
            icon: Branch,
            prior: PRIOR.toggle,
            run: () => act.toggleChanges(agent.id, !input.changesOpen),
          }),
        ]
      : []),
    ...(session
      ? [
          of({
            id: "rename-session",
            label: `rename session “${sessionTitleLabel(session)}”`,
            icon: Edit,
            prior: PRIOR.rename,
            run: () => act.renameSession(agent.id, session),
          }),
          of({
            id: "delete-session",
            label: `delete session “${sessionTitleLabel(session)}”`,
            keywords: ["remove"],
            icon: TrashCan,
            prior: PRIOR.destructive,
            destructive: true,
            run: () => act.deleteSession(agent.id, session),
          }),
        ]
      : []),
    ...(may("settings")
      ? [
          of({
            id: "rename",
            label: "rename",
            icon: Edit,
            prior: PRIOR.rename,
            input: {
              kind: "input",
              label: `New name for ${agent.name}`,
              initial: agent.name,
              submit: (name) => act.renameAgent(agent, name),
            },
          }),
        ]
      : []),
    ...(may("lifecycle")
      ? [
          ...(asleep
            ? [
                of({
                  id: "wake",
                  label: "wake",
                  keywords: ["start"],
                  icon: Awake,
                  prior: PRIOR.wake,
                  run: () => act.wake(agent.id),
                }),
              ]
            : []),
          ...(agent.state === "running" && !agent.disabled && !settling
            ? [
                of({
                  id: "restart",
                  label: "restart",
                  icon: Restart,
                  prior: PRIOR.restart,
                  run: () => act.restart(agent),
                }),
              ]
            : []),
          of({
            id: "toggle-disabled",
            label: agent.disabled ? "enable" : "disable",
            icon: Power,
            prior: PRIOR.disable,
            run: () => act.toggleDisabled(agent),
          }),
        ]
      : []),
    ...(may("delete")
      ? [
          of({
            id: "delete",
            label: "delete",
            keywords: ["remove"],
            icon: TrashCan,
            prior: PRIOR.destructive,
            destructive: true,
            run: () => act.deleteAgent(agent),
          }),
        ]
      : []),
    ...(agent.access.role === "editor"
      ? [
          of({
            id: "leave",
            label: "leave",
            keywords: ["remove"],
            icon: Exit,
            prior: PRIOR.destructive,
            destructive: true,
            run: () => act.leave(agent),
          }),
        ]
      : []),
  ];
}

function artifactCommands(
  input: PaletteInput,
  act: PaletteActions,
): PaletteCommand[] {
  return input.artifacts.map((artifact) =>
    command({
      id: `artifact:${artifact.id}`,
      label: `artifact “${artifact.title}”`,
      icon: ArtifactIcon,
      prior: PRIOR.openArtifact,
      agentId: artifact.agentId ?? undefined,
      run: () => act.openArtifact(artifact.id),
    }),
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: every command the palette offers for what the
 * app holds now: the pages, the settings tabs, the approvals, and per agent the
 * sessions, configuration sections and management tasks its permissions
 * allow. A command that would go where the person already is, such as the open
 * session or the open configuration section, is left out.
 */
export function buildCommands(
  input: PaletteInput,
  act: PaletteActions,
): PaletteCommand[] {
  const lastActivity = new Map<string, number>();
  for (const s of input.sessions)
    lastActivity.set(
      s.agentId,
      Math.max(lastActivity.get(s.agentId) ?? 0, s.activityAt),
    );
  return [
    ...globalCommands(input, act),
    ...settingsCommands(input, act),
    ...approvalCommands(input, act),
    ...input.agents.flatMap((agent) =>
      agentCommands(agent, input, act, lastActivity.get(agent.id)),
    ),
    ...artifactCommands(input, act),
  ];
}
