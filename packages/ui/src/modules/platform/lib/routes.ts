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
]);
export type SandboxSection = z.infer<typeof sandboxSectionSchema>;

export type Route =
  | { view: "list" }
  /** `session` addresses one conversation inside the agent's chat. It is what
   *  makes a session linkable from outside the UI (a channel reply pointing back
   *  at the thread it answered) and what a reload or a shared link re-opens. */
  | { view: "chat"; agent: string; session?: string }
  | { view: "settings"; settingsTab: SettingsTab }
  | { view: "inbox" }
  | { view: "terms" }
  | { view: "telegram-bind" }
  | { view: "slack-bind" }
  | { view: "sandbox-new" }
  | { view: "sandbox-home"; agentId: string; sandboxSection: SandboxSection }
  | { view: "experiments" }
  | { view: "knowledge-bases" }
  | { view: "knowledge-base-chat"; agent: string }
  | { view: "knowledge-base-config"; agentId: string }
  | { view: "artifacts" };

export type View = Route["view"];

// Alternation derived from the schema so the regex can't drift from it.
const sandboxSectionPattern = sandboxSectionSchema.options.join("|");
const sandboxHomeRe = new RegExp(
  `^/sandboxes/([^/]+)(?:/(${sandboxSectionPattern}))?$`,
);

export function parseRoute(path: string): Route {
  const chatMatch = path.match(/^\/chat\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (chatMatch) {
    return {
      view: "chat",
      agent: decodeURIComponent(chatMatch[1]!),
      ...(chatMatch[2] ? { session: decodeURIComponent(chatMatch[2]) } : {}),
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
  if (path === "/inbox") return { view: "inbox" };
  if (path === "/terms") return { view: "terms" };
  if (path === "/telegram/bind") return { view: "telegram-bind" };
  if (path === "/slack/bind") return { view: "slack-bind" };
  // Must stay above the sandbox-home regex, which would otherwise capture
  // "new" as an agent id.
  if (path === "/sandboxes/new") return { view: "sandbox-new" };
  if (path === "/artifacts") return { view: "artifacts" };
  const sandboxHomeMatch = path.match(sandboxHomeRe);
  if (sandboxHomeMatch) {
    const section = sandboxSectionSchema.safeParse(sandboxHomeMatch[2]);
    return {
      view: "sandbox-home",
      agentId: decodeURIComponent(sandboxHomeMatch[1]!),
      sandboxSection: section.success ? section.data : "setup",
    };
  }
  if (path === "/experiments") return { view: "experiments" };
  if (path === "/knowledge-bases") return { view: "knowledge-bases" };
  // Knowledge bases are created in the shared sandbox wizard now. Land old
  // links there instead of letting them fall through to the chat matcher
  // below, which would try to open a knowledge base named "new".
  if (path === "/knowledge-bases/new") return { view: "sandbox-new" };
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
  return { view: "list" };
}

export function routeToPath(route: Route): string {
  switch (route.view) {
    case "list":
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
    case "inbox":
      return "/inbox";
    case "terms":
      return "/terms";
    case "telegram-bind":
      return "/telegram/bind";
    case "slack-bind":
      return "/slack/bind";
    case "sandbox-new":
      return "/sandboxes/new";
    case "sandbox-home": {
      const base = `/sandboxes/${encodeURIComponent(route.agentId)}`;
      return route.sandboxSection === "setup"
        ? base
        : `${base}/${route.sandboxSection}`;
    }
    case "experiments":
      return "/experiments";
    case "knowledge-bases":
      return "/knowledge-bases";
    case "knowledge-base-chat":
      return `/knowledge-bases/${encodeURIComponent(route.agent)}`;
    case "knowledge-base-config":
      return `/knowledge-bases/${encodeURIComponent(route.agentId)}/settings`;
    case "artifacts":
      return "/artifacts";
    default: {
      const unhandled: never = route;
      return unhandled;
    }
  }
}

/** Map a route onto the four flat fields the navigation slice owns. */
export function routeToNavigationState(route: Route): {
  view: View;
  agentId: string | null;
  settingsTab: SettingsTab;
  sandboxSection: SandboxSection;
} {
  return {
    view: route.view,
    // The KB settings form keys off `agentId`, the same field sandbox-home
    // uses; both chat surfaces carry their agent as `selectedAgent` instead.
    agentId:
      route.view === "sandbox-home" || route.view === "knowledge-base-config"
        ? route.agentId
        : null,
    settingsTab: route.view === "settings" ? route.settingsTab : "account",
    sandboxSection:
      route.view === "sandbox-home" ? route.sandboxSection : "setup",
  };
}
