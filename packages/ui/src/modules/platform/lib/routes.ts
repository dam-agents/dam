import { starterKitCategorySchema } from "api-server-api";
import { z } from "zod";

const settingsTabSchema = z.enum([
  "account",
  "appearance",
  "providers",
  "connections",
  "api-keys",
  "usage",
  "slack-workspaces",
  "features",
]);
export type SettingsTab = z.infer<typeof settingsTabSchema>;

const sandboxSectionSchema = z.enum([
  "setup",
  "connections",
  "channels",
  "skills",
  "schedules",
  "artifacts",
  "usage",
]);
export type SandboxSection = z.infer<typeof sandboxSectionSchema>;

export type StarterKitCategory = z.infer<typeof starterKitCategorySchema>;

export type Route =
  | { view: "home" }
  | { view: "chat"; agent: string; session?: string }
  | { view: "settings"; settingsTab: SettingsTab }
  | { view: "terms" }
  | { view: "telegram-bind" }
  | { view: "slack-bind" }
  | { view: "sandbox-home"; agentId: string; sandboxSection: SandboxSection }
  | { view: "agent-new" }
  | { view: "starter-kits"; category?: StarterKitCategory }
  | { view: "starter-kit"; catalog: string; kit: string }
  | { view: "starter-kit-new"; catalog: string; kit: string }
  | { view: "artifacts" };

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
  "/experiments",
  "/experiments/",
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
  if (RETIRED_PATHS.has(path)) return { view: "home" };
  if (path === "/artifacts") return { view: "artifacts" };
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
  if (path === "/starter-kits") return { view: "starter-kits" };
  const starterKitsCategoryMatch = path.match(/^\/starter-kits\/([^/]+)$/);
  if (starterKitsCategoryMatch) {
    const category = starterKitCategorySchema.safeParse(
      decodeSegment(starterKitsCategoryMatch[1]!),
    );
    return category.success
      ? { view: "starter-kits", category: category.data }
      : { view: "starter-kits" };
  }
  const starterKitNewMatch = path.match(
    /^\/starter-kits\/([^/]+)\/([^/]+)\/new$/,
  );
  if (starterKitNewMatch)
    return {
      view: "starter-kit-new",
      catalog: decodeSegment(starterKitNewMatch[1]!),
      kit: decodeSegment(starterKitNewMatch[2]!),
    };
  const starterKitMatch = path.match(/^\/starter-kits\/([^/]+)\/([^/]+)$/);
  if (starterKitMatch)
    return {
      view: "starter-kit",
      catalog: decodeSegment(starterKitMatch[1]!),
      kit: decodeSegment(starterKitMatch[2]!),
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
    case "agent-new":
      return "/agents/new";
    case "starter-kits":
      return route.category
        ? `/starter-kits/${route.category}`
        : "/starter-kits";
    case "starter-kit":
      return `/starter-kits/${encodeURIComponent(route.catalog)}/${encodeURIComponent(route.kit)}`;
    case "starter-kit-new":
      return `/starter-kits/${encodeURIComponent(route.catalog)}/${encodeURIComponent(route.kit)}/new`;
    case "artifacts":
      return "/artifacts";
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
  starterKitCatalog: string | null;
  starterKitId: string | null;
  starterKitCategory: StarterKitCategory | null;
} {
  return {
    view: route.view,
    starterKitCategory:
      route.view === "starter-kits" ? (route.category ?? null) : null,
    agentId: route.view === "sandbox-home" ? route.agentId : null,
    starterKitCatalog:
      route.view === "starter-kit-new" || route.view === "starter-kit"
        ? route.catalog
        : null,
    starterKitId:
      route.view === "starter-kit-new" || route.view === "starter-kit"
        ? route.kit
        : null,
    settingsTab: route.view === "settings" ? route.settingsTab : "account",
    sandboxSection:
      route.view === "sandbox-home" ? route.sandboxSection : "setup",
  };
}
