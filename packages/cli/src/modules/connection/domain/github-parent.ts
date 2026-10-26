import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { isGitHubUserTokenTemplate, type ScopeKind } from "./github-scope.js";

const GITHUB_APP_TEMPLATE_IDS = new Set([
  "github-app",
  "github-enterprise-app",
]);
const MAX_NAME_LENGTH = 63;

export function splitsIntoParent(
  template: Pick<ConnectionTemplateView, "id" | "authKind">,
): boolean {
  return (
    (template.authKind === "oauth" && isGitHubUserTokenTemplate(template.id)) ||
    (template.authKind === "github-app" &&
      GITHUB_APP_TEMPLATE_IDS.has(template.id))
  );
}

export function parentLabel(parent: Pick<ConnectionView, "authKind">): string {
  return parent.authKind === "github-app"
    ? "GitHub App installation"
    : "GitHub sign-in";
}

export function parentKindOf(
  parent: Pick<ConnectionView, "authKind">,
): ScopeKind {
  return parent.authKind === "github-app" ? "github-app" : "github-user-token";
}

export function childrenOf(
  connections: readonly ConnectionView[],
  parentId: string,
): ConnectionView[] {
  return connections
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function parentOf(
  connections: readonly ConnectionView[],
  child: ConnectionView,
): ConnectionView | undefined {
  return child.parentId === undefined
    ? undefined
    : connections.find((c) => c.id === child.parentId);
}

export function freeConnectionName(
  taken: ReadonlySet<string>,
  base: string,
): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const name = `${base.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(name)) return name;
  }
}

export function nonParentNames(
  connections: readonly ConnectionView[],
): Set<string> {
  return new Set(connections.filter((c) => !c.isParent).map((c) => c.name));
}

export function scopeFlagsHint(kind: ScopeKind): string {
  return kind === "github-app"
    ? "--repositories <names> --permissions <pairs>"
    : "--account <login> --repositories <names> --permissions <pairs>";
}

export function connectFromHint(
  parent: Pick<ConnectionView, "id" | "authKind">,
): string {
  return (
    `  dam connection connect --from ${parent.id} ${scopeFlagsHint(parentKindOf(parent))}\n` +
    `  dam connection connect --from ${parent.id} --full-access   # everything it reaches\n`
  );
}
