import { type Route, routeToPath } from "../../platform/lib/routes.js";

export const ID_TESTID_PREFIXES = [
  "artifacts-folder-",
  "catalog-add-",
  "catalog-add-blocked-",
  "catalog-connection-",
  "catalog-connection-account-",
  "catalog-connection-check-",
  "catalog-edit-scope-",
  "catalog-fix-",
  "catalog-menu-",
  "catalog-narrow-",
  "catalog-option-",
  "catalog-reauth-",
  "catalog-remove-",
  "catalog-update-credential-",
  "connection-children-",
  "connection-choose-reach-",
  "connection-field-",
  "connection-full-access-",
  "connection-new-child-",
  "connection-parent-",
  "connection-parent-empty-",
  "connection-scope-",
  "egress-group-",
  "env-group-",
  "github-app-repo-",
  "github-user-account-",
  "prefer-connection-",
  "secret-request-",
  "secret-request-audience-",
  "skill-toggle-",
  "starter-kit-card-",
  "starter-kit-schedule-",
  "starter-kit-schedule-instructions-",
  "starter-kit-schedule-settings-",
] as const;

export const FIXED_TESTID_PREFIXES = [
  "catalog-new-",
  "catalog-provider-",
  "connection-group-",
  "default-accounts-",
  "egress-preset-",
  "github-app-perm-",
  "section-add-",
  "share-visibility-",
  "side-panel-badge-",
  "side-panel-tab-",
  "starter-kit-connect-",
  "starter-kit-connected-",
  "starter-kit-requirement-",
] as const;

const MAX_ELEMENT = 120;
const ID_TOKEN = /^(?=.*\d)[A-Za-z0-9_]{6,}$/;

const longestPrefix = (testId: string, prefixes: readonly string[]) =>
  prefixes
    .filter((p) => testId.startsWith(p))
    .reduce<string | null>(
      (best, p) => (best === null || p.length > best.length ? p : best),
      null,
    );

export function elementOf(testId: string): string | null {
  const idPrefix = longestPrefix(testId, ID_TESTID_PREFIXES);
  const fixedPrefix = longestPrefix(testId, FIXED_TESTID_PREFIXES);
  if (idPrefix && (!fixedPrefix || idPrefix.length > fixedPrefix.length)) {
    return `${idPrefix}:id`;
  }
  const scrubbed = testId
    .split("-")
    .map((token) => (ID_TOKEN.test(token) ? ":id" : token))
    .join("-")
    .replace(/[^A-Za-z0-9:._-]/g, "_")
    .slice(0, MAX_ELEMENT);
  return scrubbed.length > 0 ? scrubbed : null;
}

export function routePattern(route: Route): string {
  switch (route.view) {
    case "chat":
      return route.session ? "/chat/:agent/:session" : "/chat/:agent";
    case "settings":
      return `/settings/${route.settingsTab}`;
    case "sandbox-home":
      return `/sandboxes/:agent/${route.sandboxSection}`;
    case "starter-kit":
      return "/starter-kits/:catalog/:kit";
    case "not-found":
      return "/not-found";
    default:
      return routeToPath(route);
  }
}
