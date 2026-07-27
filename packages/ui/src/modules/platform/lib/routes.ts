import { z } from "zod";

export const viewSchema = z.enum([
  "list",
  "chat",
  "settings",
  "inbox",
  "terms",
  "telegram-bind",
  "slack-bind",
  "sandbox-new",
  "sandbox-home",
  "experiments",
  "experiment-new",
  "experiment-detail",
  "knowledge-bases",
  "knowledge-base-new",
  "knowledge-base-chat",
  "knowledge-base-config",
  "artifacts",
]);
export type View = z.infer<typeof viewSchema>;

export const settingsTabSchema = z.enum([
  "account",
  "appearance",
  "providers",
  "connections",
  "api-keys",
  "usage",
  "features",
]);
export type SettingsTab = z.infer<typeof settingsTabSchema>;

export const sandboxSectionSchema = z.enum([
  "setup",
  "connections",
  "channels",
  "skills",
  "schedules",
  "artifacts",
]);
export type SandboxSection = z.infer<typeof sandboxSectionSchema>;

export function viewToPath(
  view: View,
  agent?: string | null,
  agentId?: string | null,
  settingsTab?: SettingsTab | null,
  experimentId?: string | null,
  sandboxSection?: SandboxSection | null,
): string {
  if (view === "chat" && agent) return `/chat/${encodeURIComponent(agent)}`;
  if (view === "settings")
    return settingsTab && settingsTab !== "account"
      ? `/settings/${settingsTab}`
      : "/settings";
  if (view === "inbox") return "/inbox";
  if (view === "terms") return "/terms";
  if (view === "telegram-bind") return "/telegram/bind";
  if (view === "slack-bind") return "/slack/bind";
  if (view === "sandbox-new") return "/sandboxes/new";
  if (view === "sandbox-home" && agentId) {
    const base = `/sandboxes/${encodeURIComponent(agentId)}`;
    return sandboxSection && sandboxSection !== "setup"
      ? `${base}/${sandboxSection}`
      : base;
  }
  if (view === "experiments") return "/experiments";
  if (view === "experiment-new") return "/experiments/new";
  if (view === "experiment-detail" && experimentId)
    return `/experiments/${encodeURIComponent(experimentId)}`;
  if (view === "knowledge-bases") return "/knowledge-bases";
  if (view === "knowledge-base-new") return "/knowledge-bases/new";
  if (view === "knowledge-base-chat" && agent)
    return `/knowledge-bases/${encodeURIComponent(agent)}`;
  if (view === "knowledge-base-config" && agentId)
    return `/knowledge-bases/${encodeURIComponent(agentId)}/settings`;
  if (view === "artifacts") return "/artifacts";
  return "/";
}

export function pathToState(path: string): {
  view: View;
  agent?: string;
  agentId?: string;
  settingsTab?: SettingsTab;
  experimentId?: string;
  sandboxSection?: SandboxSection;
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
  if (path === "/telegram/bind") return { view: "telegram-bind" };
  if (path === "/slack/bind") return { view: "slack-bind" };
  if (path === "/sandboxes/new") return { view: "sandbox-new" };
  if (path === "/artifacts") return { view: "artifacts" };
  const sandboxHomeMatch = path.match(
    /^\/sandboxes\/([^/]+)(?:\/(setup|connections|channels|skills|schedules|artifacts))?$/,
  );
  if (sandboxHomeMatch)
    return {
      view: "sandbox-home",
      agentId: decodeURIComponent(sandboxHomeMatch[1]!),
      sandboxSection: (sandboxHomeMatch[2] as SandboxSection) ?? "setup",
    };
  if (path === "/experiments") return { view: "experiments" };
  if (path === "/experiments/new") return { view: "experiment-new" };
  if (path === "/knowledge-bases") return { view: "knowledge-bases" };
  if (path === "/knowledge-bases/new") return { view: "knowledge-base-new" };
  const knowledgeBaseConfigMatch = path.match(
    /^\/knowledge-bases\/([^/]+)\/settings$/,
  );
  if (knowledgeBaseConfigMatch)
    return {
      view: "knowledge-base-config",
      agentId: decodeURIComponent(knowledgeBaseConfigMatch[1]!),
    };
  const knowledgeBaseChatMatch = path.match(/^\/knowledge-bases\/([^/]+)$/);
  if (knowledgeBaseChatMatch)
    return {
      view: "knowledge-base-chat",
      agent: decodeURIComponent(knowledgeBaseChatMatch[1]!),
    };
  const experimentDetailMatch = path.match(/^\/experiments\/([^/]+)$/);
  if (experimentDetailMatch)
    return {
      view: "experiment-detail",
      experimentId: decodeURIComponent(experimentDetailMatch[1]!),
    };
  return { view: "list" };
}
