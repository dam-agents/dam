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
  | { view: "agents" }
  | { view: "agent-new" }
  | { view: "knowledge-base-chat"; agent: string }
  | { view: "knowledge-bases" }
  | { view: "knowledge-base-new" }
  | { view: "knowledge-base-config"; agentId: string }
  | { view: "artifacts" }
  | { view: "packs" }
  | { view: "setup-workbench" };

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
  "/coding-agents",
  "/coding-agents/new",
  "/experiments",
  "/experiments/new",
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
  if (RETIRED_PATHS.has(path)) return { view: "agents" };
  if (path === "/artifacts") return { view: "artifacts" };
  if (path === "/packs") return { view: "packs" };
  if (path === "/setup-workbench") return { view: "setup-workbench" };
  const sandboxHomeMatch = path.match(sandboxHomeRe);
  if (sandboxHomeMatch) {
    const section = sandboxSectionSchema.safeParse(sandboxHomeMatch[2]);
    return {
      view: "sandbox-home",
      agentId: decodeSegment(sandboxHomeMatch[1]!),
      sandboxSection: section.success ? section.data : "setup",
    };
  }
  if (path === "/agents/new") return { view: "agent-new" };
  if (path === "/agents") return { view: "agents" };
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
    case "agents":
      return "/agents";
    case "agent-new":
      return "/agents/new";
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
    case "packs":
      return "/packs";
    case "setup-workbench":
      return "/setup-workbench";
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
