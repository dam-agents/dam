import type { ApprovalView, SessionView } from "api-server-api";
import type { ComponentType } from "react";

import type { AgentView } from "../../../types.js";
import type {
  SandboxSection,
  SettingsTab,
  View,
} from "../../platform/lib/routes.js";
import type { Theme } from "../../platform/store/theme.js";
import type { BindMessenger } from "../../sandboxes/components/channels/messenger-instructions.js";
import type { IndexedArtifact, IndexedSession } from "./palette-storage.js";
import type { Rankable } from "./ranking.js";

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
  checklist: "open" | "closed" | null;
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
  setChecklistOpen: (open: boolean) => void;
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

export interface CommandSpec {
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

export function command({
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
