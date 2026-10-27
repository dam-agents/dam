import {
  Add,
  Asleep,
  Book,
  DataEnrichmentAdd,
  Gift,
  Home,
  Light,
  LogoSlack,
  Logout,
  Misuse,
  Notification,
  Screen,
  Settings,
  View as ViewIcon,
  ViewOff,
} from "@carbon/icons-react";

import { TelegramIcon } from "@/components/brand-icons";

import { ArtifactIcon } from "../../artifacts/lib/artifact-icon.js";
import type { SettingsTab } from "../../platform/lib/routes.js";
import type { Theme } from "../../platform/store/theme.js";
import { agentCommands } from "./agent-commands.js";
import {
  command,
  type PaletteActions,
  type PaletteCommand,
  type PaletteInput,
} from "./palette-command.js";
import { RANKING } from "./ranking.js";

const PRIOR = RANKING.PRIOR;

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
