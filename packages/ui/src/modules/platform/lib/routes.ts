import { z } from "zod";

import { isShowExperimentsEnabled } from "../../experiments/internal-only.js";

export const viewSchema = z.enum([
  "list",
  "chat",
  "settings",
  "inbox",
  "terms",
  "sandbox-new",
  "sandbox-settings",
  "experiments",
  "experiment-new",
  "experiment-detail",
]);
export type View = z.infer<typeof viewSchema>;

export const settingsTabSchema = z.enum([
  "account",
  "appearance",
  "providers",
  "connections",
  "api-keys",
]);
export type SettingsTab = z.infer<typeof settingsTabSchema>;

export function viewToPath(
  view: View,
  agent?: string | null,
  agentId?: string | null,
  settingsTab?: SettingsTab | null,
  experimentId?: string | null,
): string {
  if (view === "chat" && agent) return `/chat/${encodeURIComponent(agent)}`;
  if (view === "settings")
    return settingsTab && settingsTab !== "account"
      ? `/settings/${settingsTab}`
      : "/settings";
  if (view === "inbox") return "/inbox";
  if (view === "terms") return "/terms";
  if (view === "sandbox-new") return "/sandboxes/new";
  if (view === "sandbox-settings" && agentId)
    return `/sandboxes/${encodeURIComponent(agentId)}`;
  if (view === "experiments") return "/experiments";
  if (view === "experiment-new") return "/experiments/new";
  if (view === "experiment-detail" && experimentId)
    return `/experiments/${encodeURIComponent(experimentId)}`;
  return "/";
}

export function pathToState(path: string): {
  view: View;
  agent?: string;
  agentId?: string;
  settingsTab?: SettingsTab;
  experimentId?: string;
} {
  if (path.startsWith("/chat/"))
    return { view: "chat", agent: decodeURIComponent(path.slice(6)) };
  if (path === "/settings") return { view: "settings", settingsTab: "account" };
  const settingsMatch = path.match(/^\/settings\/([^/]+)$/);
  if (settingsMatch) {
    const tab = settingsTabSchema.safeParse(settingsMatch[1]);
    return {
      view: "settings",
      settingsTab: tab.success ? tab.data : "account",
    };
  }
  if (path === "/inbox") return { view: "inbox" };
  if (path === "/terms") return { view: "terms" };
  if (path === "/sandboxes/new") return { view: "sandbox-new" };
  const sandboxSettingsMatch = path.match(/^\/sandboxes\/([^/]+)$/);
  if (sandboxSettingsMatch)
    return {
      view: "sandbox-settings",
      agentId: decodeURIComponent(sandboxSettingsMatch[1]!),
    };
  if (
    (path === "/experiments" || path.startsWith("/experiments/")) &&
    !isShowExperimentsEnabled()
  )
    return { view: "list" };
  if (path === "/experiments") return { view: "experiments" };
  if (path === "/experiments/new") return { view: "experiment-new" };
  const experimentDetailMatch = path.match(/^\/experiments\/([^/]+)$/);
  if (experimentDetailMatch)
    return {
      view: "experiment-detail",
      experimentId: decodeURIComponent(experimentDetailMatch[1]!),
    };
  return { view: "list" };
}
