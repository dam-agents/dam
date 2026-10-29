import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { match } from "ts-pattern";

import { validateConnectionName } from "./connection-name.js";
import { githubCredentialKind } from "./github-access.js";

type HierarchyFields = Pick<ConnectionView, "id" | "isParent" | "parentId">;
type NamedHierarchyFields = HierarchyFields & Pick<ConnectionView, "name">;

export interface ConnectionEntry<T> {
  connection: T;
  children?: T[];
}

export function isGrantable(
  connection: Pick<ConnectionView, "isParent">,
): boolean {
  return connection.isParent !== true;
}

export function childrenOf<T extends HierarchyFields>(
  parentId: string,
  connections: readonly T[],
): T[] {
  return connections.filter((c) => c.parentId === parentId);
}

export function awaitingFirstConnection<T extends HierarchyFields>(
  connectionId: string,
  connections: readonly T[],
): T | null {
  const parent = connections.find((c) => c.id === connectionId);
  if (!parent?.isParent) return null;
  return childrenOf(parent.id, connections).length === 0 ? parent : null;
}

export function nestConnections<T extends HierarchyFields>(
  connections: readonly T[],
): ConnectionEntry<T>[] {
  const parentIds = new Set(
    connections.filter((c) => c.isParent).map((c) => c.id),
  );
  const listedUnderParent = (c: T) =>
    c.parentId !== undefined && parentIds.has(c.parentId);
  return connections.flatMap((c): ConnectionEntry<T>[] => {
    if (listedUnderParent(c)) return [];
    if (!c.isParent) return [{ connection: c }];
    return [{ connection: c, children: childrenOf(c.id, connections) }];
  });
}

export function parentNoun(
  connection: Pick<ConnectionView, "authKind">,
): string {
  return match(githubCredentialKind(connection))
    .with("installation", () => "GitHub App installation")
    .with("sign-in", () => "GitHub sign-in")
    .exhaustive();
}

export function parentAddedMessage(
  parent: Pick<ConnectionView, "authKind">,
): string {
  const done = match(githubCredentialKind(parent))
    .with("installation", () => "GitHub App installation added.")
    .with("sign-in", () => "Signed in to GitHub.")
    .exhaustive();
  return `${done} Pick New connection on it when an agent needs one.`;
}

const NAME_MAX = 63;

function numberedName(base: string, taken: ReadonlySet<string>): string {
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const stem = base.slice(0, NAME_MAX - suffix.length).replace(/-+$/, "");
    const candidate = `${stem}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function freeName(base: string, taken: ReadonlySet<string>): string {
  return taken.has(base) ? numberedName(base, taken) : base;
}

export function defaultChildName(
  parent: Pick<ConnectionView, "id" | "name">,
  connections: readonly NamedHierarchyFields[],
): string {
  const taken = new Set(connections.filter(isGrantable).map((c) => c.name));
  const firstChild = childrenOf(parent.id, connections).length === 0;
  return firstChild
    ? freeName(parent.name, taken)
    : numberedName(parent.name, taken);
}

const PARENT_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  "github",
  "github-enterprise",
  "github-app",
  "github-enterprise-app",
]);

export interface NewNameRule {
  taken: ReadonlySet<string>;
  message: string;
}

export function newParentNameRule(
  template: Pick<ConnectionTemplateView, "id" | "authKind">,
  connections: readonly NamedHierarchyFields[],
): NewNameRule | null {
  if (!PARENT_TEMPLATE_IDS.has(template.id)) return null;
  const names = (keep: (c: NamedHierarchyFields) => boolean) =>
    new Set(connections.filter(keep).map((c) => c.name));
  return match(githubCredentialKind(template))
    .with("sign-in", () => ({
      taken: names((c) => c.isParent === true),
      message: "You already have a GitHub sign-in with this name",
    }))
    .with("installation", () => ({
      taken: names(() => true),
      message:
        "You already have a GitHub App installation or a connection with this name",
    }))
    .exhaustive();
}

export function childNameError(
  name: string,
  connections: readonly NamedHierarchyFields[],
): string | null {
  const invalid = validateConnectionName(name);
  if (invalid) return invalid;
  return connections.some((c) => isGrantable(c) && c.name === name)
    ? "You already have a connection with this name"
    : null;
}

export function createChildHeading(
  parent: Pick<ConnectionView, "authKind" | "name" | "accountLabel">,
): { title: string; subtitle: string } {
  const account = parent.accountLabel ? ` (${parent.accountLabel})` : "";
  return {
    title: "What should this connection reach?",
    subtitle: `From the ${parentNoun(parent)} ${parent.name}${account}`,
  };
}
