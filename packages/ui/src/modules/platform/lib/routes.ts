import { LINKED_KIT_CATALOG, SANDBOX_SECTIONS } from "api-server-api";
import { z } from "zod";

const settingsTabSchema = z.enum([
  "account",
  "appearance",
  "providers",
  "connections",
  "api-keys",
  "usage",
  "schedules",
  "slack-workspaces",
  "analytics",
  "operator",
  "features",
  "about",
]);
export type SettingsTab = z.infer<typeof settingsTabSchema>;

const sandboxSectionSchema = z.enum(SANDBOX_SECTIONS);
export type SandboxSection = z.infer<typeof sandboxSectionSchema>;

export type Route =
  | { view: "home" }
  | { view: "artifacts" }
  | { view: "starter-kits" }
  | { view: "chat"; agent: string; session?: string }
  | { view: "settings"; settingsTab: SettingsTab; period?: string }
  | { view: "terms" }
  | { view: "telegram-bind" }
  | { view: "slack-bind" }
  | { view: "connection-secret" }
  | { view: "sandbox-home"; agentId: string; sandboxSection: SandboxSection }
  | { view: "starter-kit"; catalog: string; kit: string }
  | { view: "analytics" }
  | { view: "not-found"; path: string };

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
  "/agents/new",
]);

const sandboxSectionPattern = sandboxSectionSchema.options.join("|");
const sandboxHomeRe = new RegExp(
  `^/sandboxes/([^/]+)(?:/(${sandboxSectionPattern}))?$`,
);

const PERIOD_PARAM = "period";

function usagePeriodOf(search: string): { period?: string } {
  const period = new URLSearchParams(search).get(PERIOD_PARAM);
  return period ? { period } : {};
}

export function parseRoute(path: string, search = ""): Route {
  if (path === "/") return { view: "home" };
  const chatMatch = path.match(/^\/chat\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (chatMatch) {
    return {
      view: "chat",
      agent: decodeSegment(chatMatch[1]!),
      ...(chatMatch[2] ? { session: decodeSegment(chatMatch[2]) } : {}),
    };
  }
  if (path === "/settings") return { view: "settings", settingsTab: "account" };
  if (path === "/artifacts") return { view: "artifacts" };
  if (path === "/starter-kits") return { view: "starter-kits" };
  const settingsMatch = path.match(/^\/settings\/([^/]+)$/);
  if (settingsMatch) {
    const tab = settingsTabSchema.safeParse(settingsMatch[1]);
    if (tab.success) {
      return {
        view: "settings",
        settingsTab: tab.data,
        ...(tab.data === "usage" ? usagePeriodOf(search) : {}),
      };
    }
  }
  if (path === "/terms") return { view: "terms" };
  if (path === "/telegram/bind") return { view: "telegram-bind" };
  if (path === "/slack/bind") return { view: "slack-bind" };
  if (path === "/connections/secret") return { view: "connection-secret" };
  if (RETIRED_PATHS.has(path)) return { view: "home" };
  if (path === "/analytics") return { view: "analytics" };
  const sandboxHomeMatch = path.match(sandboxHomeRe);
  if (sandboxHomeMatch) {
    const section = sandboxSectionSchema.safeParse(sandboxHomeMatch[2]);
    return {
      view: "sandbox-home",
      agentId: decodeSegment(sandboxHomeMatch[1]!),
      sandboxSection: section.success ? section.data : "setup",
    };
  }
  if (/^\/starter-kits\/[^/]+$/.test(path)) return { view: "home" };
  const linkedKitMatch = path.match(
    new RegExp(`^/starter-kits/${LINKED_KIT_CATALOG}/([^/]+)/([^/]+)$`),
  );
  if (linkedKitMatch)
    return {
      view: "starter-kit",
      catalog: LINKED_KIT_CATALOG,
      kit: `${decodeSegment(linkedKitMatch[1]!)}/${decodeSegment(linkedKitMatch[2]!)}`,
    };
  const starterKitMatch = path.match(
    /^\/starter-kits\/([^/]+)\/([^/]+)(?:\/new)?$/,
  );
  if (starterKitMatch)
    return {
      view: "starter-kit",
      catalog: decodeSegment(starterKitMatch[1]!),
      kit: decodeSegment(starterKitMatch[2]!),
    };
  return { view: "not-found", path };
}

export function routeToPath(route: Route): string {
  switch (route.view) {
    case "home":
      return "/";
    case "artifacts":
      return "/artifacts";
    case "starter-kits":
      return "/starter-kits";
    case "chat": {
      const base = `/chat/${encodeURIComponent(route.agent)}`;
      return route.session
        ? `${base}/${encodeURIComponent(route.session)}`
        : base;
    }
    case "settings": {
      if (route.settingsTab === "account") return "/settings";
      const base = `/settings/${route.settingsTab}`;
      return route.settingsTab === "usage" && route.period
        ? `${base}?${new URLSearchParams({ [PERIOD_PARAM]: route.period })}`
        : base;
    }
    case "terms":
      return "/terms";
    case "telegram-bind":
      return "/telegram/bind";
    case "slack-bind":
      return "/slack/bind";
    case "connection-secret":
      return "/connections/secret";
    case "sandbox-home": {
      const base = `/sandboxes/${encodeURIComponent(route.agentId)}`;
      return route.sandboxSection === "setup"
        ? base
        : `${base}/${route.sandboxSection}`;
    }
    case "starter-kit":
      return `/starter-kits/${encodeURIComponent(route.catalog)}/${
        route.catalog === LINKED_KIT_CATALOG
          ? route.kit.split("/").map(encodeURIComponent).join("/")
          : encodeURIComponent(route.kit)
      }`;
    case "analytics":
      return "/analytics";
    case "not-found":
      return route.path;
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
  usagePeriod: string | null;
  sandboxSection: SandboxSection;
  starterKitCatalog: string | null;
  starterKitId: string | null;
} {
  return {
    view: route.view,
    agentId: route.view === "sandbox-home" ? route.agentId : null,
    starterKitCatalog: route.view === "starter-kit" ? route.catalog : null,
    starterKitId: route.view === "starter-kit" ? route.kit : null,
    settingsTab: route.view === "settings" ? route.settingsTab : "account",
    usagePeriod: route.view === "settings" ? (route.period ?? null) : null,
    sandboxSection:
      route.view === "sandbox-home" ? route.sandboxSection : "setup",
  };
}
