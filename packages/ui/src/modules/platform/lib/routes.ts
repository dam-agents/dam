import { LINKED_KIT_CATALOG, SANDBOX_SECTIONS } from "api-server-api";
import { z } from "zod";

const settingsTabSchema = z.enum([
  "account",
  "appearance",
  "providers",
  "profiles",
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
  | { view: "artifacts"; artifactId?: string }
  | { view: "artifact"; artifactId: string }
  | { view: "starter-kits" }
  | {
      view: "chat";
      agent: string;
      session?: string;
      /** UNIT_BOUNDARY_DESCRIPTION: an old agent page link, `/sandboxes/<id>/<section>`, opens the agent's chat with its settings modal on this section; the chat's own address never carries it. */
      settings?: SandboxSection;
    }
  | {
      view: "settings";
      settingsTab: SettingsTab;
      period?: string;
      profileId?: string;
    }
  | { view: "terms" }
  | { view: "telegram-bind" }
  | { view: "slack-bind" }
  | { view: "connection-secret" }
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: the address that opens an Agent's chat with its
 * settings modal on a section: the same `/sandboxes/<id>/<section>` the server
 * writes into messages, so a redirect back from a sign-in lands on the modal
 * as an old link does.
 */
export function agentSettingsPath(
  agentId: string,
  section: SandboxSection = "setup",
): string {
  const base = `/sandboxes/${encodeURIComponent(agentId)}`;
  return section === "setup" ? base : `${base}/${section}`;
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
/* UNIT_BOUNDARY_DESCRIPTION: the agent page's address, which the server still writes into Slack and Telegram messages (agentPageUrl); there is no such page any more, so it opens the agent's chat with its settings modal. */
const agentPageRe = new RegExp(
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
  const artifactPageMatch = path.match(/^\/artifacts\/([^/]+)\/view\/?$/);
  if (artifactPageMatch)
    return {
      view: "artifact",
      artifactId: decodeSegment(artifactPageMatch[1]!),
    };
  const artifactMatch = path.match(/^\/artifacts\/([^/]+)\/?$/);
  if (artifactMatch)
    return { view: "artifacts", artifactId: decodeSegment(artifactMatch[1]!) };
  if (path === "/starter-kits") return { view: "starter-kits" };
  const settingsMatch = path.match(/^\/settings\/([^/]+)(?:\/([^/]+))?$/);
  if (settingsMatch) {
    const tab = settingsTabSchema.safeParse(settingsMatch[1]);
    if (
      tab.success &&
      (settingsMatch[2] === undefined || tab.data === "profiles")
    ) {
      return {
        view: "settings",
        settingsTab: tab.data,
        ...(tab.data === "usage" ? usagePeriodOf(search) : {}),
        ...(tab.data === "profiles" && settingsMatch[2]
          ? { profileId: decodeSegment(settingsMatch[2]) }
          : {}),
      };
    }
  }
  if (path === "/terms") return { view: "terms" };
  if (path === "/telegram/bind") return { view: "telegram-bind" };
  if (path === "/slack/bind") return { view: "slack-bind" };
  if (path === "/connections/secret") return { view: "connection-secret" };
  if (RETIRED_PATHS.has(path)) return { view: "home" };
  if (path === "/analytics") return { view: "analytics" };
  const agentPageMatch = path.match(agentPageRe);
  if (agentPageMatch) {
    const section = sandboxSectionSchema.safeParse(agentPageMatch[2]);
    return {
      view: "chat",
      agent: decodeSegment(agentPageMatch[1]!),
      settings: section.success ? section.data : "setup",
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
      return route.artifactId
        ? `/artifacts/${encodeURIComponent(route.artifactId)}`
        : "/artifacts";
    case "artifact":
      return `/artifacts/${encodeURIComponent(route.artifactId)}/view`;
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
      if (route.settingsTab === "profiles" && route.profileId)
        return `${base}/${encodeURIComponent(route.profileId)}`;
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
  artifactId: string | null;
  pageArtifactId: string | null;
  settingsTab: SettingsTab;
  settingsProfileId: string | null;
  usagePeriod: string | null;
  starterKitCatalog: string | null;
  starterKitId: string | null;
} {
  return {
    view: route.view,
    artifactId: route.view === "artifacts" ? (route.artifactId ?? null) : null,
    pageArtifactId: route.view === "artifact" ? route.artifactId : null,
    starterKitCatalog: route.view === "starter-kit" ? route.catalog : null,
    starterKitId: route.view === "starter-kit" ? route.kit : null,
    settingsTab: route.view === "settings" ? route.settingsTab : "account",
    settingsProfileId:
      route.view === "settings" ? (route.profileId ?? null) : null,
    usagePeriod: route.view === "settings" ? (route.period ?? null) : null,
  };
}
