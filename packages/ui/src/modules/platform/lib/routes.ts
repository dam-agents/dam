import { z } from "zod";

export const viewSchema = z.enum([
  "list",
  "chat",
  "settings",
  "inbox",
  "agent-egress",
  "terms",
  "sandbox-new",
  "v2-list",
  "v2-new",
  "v2-terminal",
]);
export type View = z.infer<typeof viewSchema>;

export const settingsTabSchema = z.enum([
  "account",
  "appearance",
  "providers",
  "connections",
]);
export type SettingsTab = z.infer<typeof settingsTabSchema>;

export function viewToPath(
  view: View,
  agent?: string | null,
  agentId?: string | null,
  settingsTab?: SettingsTab | null,
): string {
  if (view === "chat" && agent) return `/chat/${encodeURIComponent(agent)}`;
  if (view === "settings")
    return settingsTab && settingsTab !== "account"
      ? `/settings/${settingsTab}`
      : "/settings";
  if (view === "inbox") return "/inbox";
  if (view === "agent-egress" && agentId)
    return `/agents/${encodeURIComponent(agentId)}/egress`;
  if (view === "terms") return "/terms";
  if (view === "sandbox-new") return "/sandboxes/new";
  if (view === "v2-list") return "/v2";
  if (view === "v2-new") return "/v2/new";
  if (view === "v2-terminal" && agentId)
    return `/v2/${encodeURIComponent(agentId)}`;
  return "/";
}

export function pathToState(path: string): {
  view: View;
  agent?: string;
  agentId?: string;
  settingsTab?: SettingsTab;
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
  if (path === "/v2") return { view: "v2-list" };
  if (path === "/v2/new") return { view: "v2-new" };
  const sandboxMatch = path.match(/^\/v2\/([^/]+)$/);
  if (sandboxMatch)
    return {
      view: "v2-terminal",
      agentId: decodeURIComponent(sandboxMatch[1]!),
    };
  const egressMatch = path.match(/^\/agents\/([^/]+)\/egress$/);
  if (egressMatch)
    return {
      view: "agent-egress",
      agentId: decodeURIComponent(egressMatch[1]!),
    };
  return { view: "list" };
}
