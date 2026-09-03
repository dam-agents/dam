import { z } from "zod";

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
  "usage",
]);
export type SandboxSection = z.infer<typeof sandboxSectionSchema>;

export type Route =
  | { view: "home" }
  | { view: "chat"; agent: string; session?: string }
  | { view: "settings"; settingsTab: SettingsTab }
  | { view: "terms" }
  | { view: "telegram-bind" }
  | { view: "slack-bind" }
  | { view: "sandbox-home"; agentId: string; sandboxSection: SandboxSection }
  | { view: "coding-agents" }
  | { view: "coding-agent-new" }
  | { view: "experiments" }
  | { view: "experiment-new" }
  | { view: "knowledge-base-new" }
  | { view: "knowledge-bases" }
  | { view: "knowledge-base-chat"; agent: string }
  | { view: "knowledge-base-config"; agentId: string }
  | { view: "artifacts" }
  | { view: "slack-cards-preview" }
  | { view: "overflow-preview" }
  | { view: "bind-success-preview" }
  | { view: "bind-pick-agent-preview" };

export type View = Route["view"];

const publicAgentRe = /^\/a\/([^/]+)\/?$/;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parsePublicAgentPath(pathname: string): string | null {
  const match = pathname.match(publicAgentRe);
  return match ? decodeSegment(match[1]!) : null;
}

export function publicAgentPath(agentId: string): string {
  return `/a/${encodeURIComponent(agentId)}`;
}

export const RETIRED_PATHS = new Set([
  "/sandboxes",
  "/sandboxes/",
  "/sandboxes/new",
  "/inbox",
]);

const sandboxSectionPattern = sandboxSectionSchema.options.join("|");
const sandboxHomeRe = new RegExp(
  `^/sandboxes/([^/]+)(?:/(${sandboxSectionPattern}))?$`,
);

export function parseRoute(path: string): Route {
  const chatMatch = path.match(/^\/chat\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (chatMatch) {
    return {
      view: "chat",
      agent: decodeSegment(chatMatch[1]!),
      ...(chatMatch[2] ? { session: decodeSegment(chatMatch[2]) } : {}),
    };
  }
  if (path === "/settings") return { view: "settings", settingsTab: "account" };
  const settingsMatch = path.match(/^\/settings\/([^/]+)$/);
  if (settingsMatch) {
    const tab = settingsTabSchema.safeParse(settingsMatch[1]);
    return {
      view: "settings",
      settingsTab: tab.success ? tab.data : "account",
    };
  }
  if (path === "/terms") return { view: "terms" };
  if (path === "/telegram/bind") return { view: "telegram-bind" };
  if (path === "/slack/bind") return { view: "slack-bind" };
  if (RETIRED_PATHS.has(path)) return { view: "home" };
  if (path === "/artifacts") return { view: "artifacts" };
  if (path === "/slack-cards-preview") return { view: "slack-cards-preview" };
  if (path === "/overflow-preview") return { view: "overflow-preview" };
  if (path === "/bind-success-preview")
    return { view: "bind-success-preview" };
  if (path === "/bind-pick-agent-preview")
    return { view: "bind-pick-agent-preview" };
  const sandboxHomeMatch = path.match(sandboxHomeRe);
  if (sandboxHomeMatch) {
    const section = sandboxSectionSchema.safeParse(sandboxHomeMatch[2]);
    return {
      view: "sandbox-home",
      agentId: decodeSegment(sandboxHomeMatch[1]!),
      sandboxSection: section.success ? section.data : "setup",
    };
  }
  if (path === "/coding-agents/new") return { view: "coding-agent-new" };
  if (path === "/coding-agents") return { view: "coding-agents" };
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
      agentId: decodeSegment(knowledgeBaseConfigMatch[1]!),
    };
  const knowledgeBaseChatMatch = path.match(/^\/knowledge-bases\/([^/]+)$/);
  if (knowledgeBaseChatMatch)
    return {
      view: "knowledge-base-chat",
      agent: decodeSegment(knowledgeBaseChatMatch[1]!),
    };
  return { view: "home" };
}

export function routeToPath(route: Route): string {
  switch (route.view) {
    case "home":
      return "/";
    case "chat": {
      const base = `/chat/${encodeURIComponent(route.agent)}`;
      return route.session
        ? `${base}/${encodeURIComponent(route.session)}`
        : base;
    }
    case "settings":
      return route.settingsTab === "account"
        ? "/settings"
        : `/settings/${route.settingsTab}`;
    case "terms":
      return "/terms";
    case "telegram-bind":
      return "/telegram/bind";
    case "slack-bind":
      return "/slack/bind";
    case "sandbox-home": {
      const base = `/sandboxes/${encodeURIComponent(route.agentId)}`;
      return route.sandboxSection === "setup"
        ? base
        : `${base}/${route.sandboxSection}`;
    }
    case "coding-agents":
      return "/coding-agents";
    case "coding-agent-new":
      return "/coding-agents/new";
    case "experiments":
      return "/experiments";
    case "experiment-new":
      return "/experiments/new";
    case "knowledge-bases":
      return "/knowledge-bases";
    case "knowledge-base-new":
      return "/knowledge-bases/new";
    case "knowledge-base-chat":
      return `/knowledge-bases/${encodeURIComponent(route.agent)}`;
    case "knowledge-base-config":
      return `/knowledge-bases/${encodeURIComponent(route.agentId)}/settings`;
    case "artifacts":
      return "/artifacts";
    case "slack-cards-preview":
      return "/slack-cards-preview";
    case "overflow-preview":
      return "/overflow-preview";
    case "bind-success-preview":
      return "/bind-success-preview";
    case "bind-pick-agent-preview":
      return "/bind-pick-agent-preview";
    default: {
      const unhandled: never = route;
      return unhandled;
    }
  }
}

export function routeToNavigationState(route: Route): {
  view: View;
  agentId: string | null;
  settingsTab: SettingsTab;
  sandboxSection: SandboxSection;
} {
  return {
    view: route.view,
    agentId:
      route.view === "sandbox-home" || route.view === "knowledge-base-config"
        ? route.agentId
        : null,
    settingsTab: route.view === "settings" ? route.settingsTab : "account",
    sandboxSection:
      route.view === "sandbox-home" ? route.sandboxSection : "setup",
  };
}
