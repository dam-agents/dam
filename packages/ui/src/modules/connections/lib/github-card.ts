import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { match } from "ts-pattern";

import { getBrand } from "../../../brand.js";
import type { RowMaintenanceActions } from "../components/catalog-connection-row.js";
import {
  githubCredentialKind,
  permissionsPhrase,
  repositoriesPhrase,
} from "./github-access.js";

type ChildFields = Pick<
  ConnectionView,
  | "name"
  | "authKind"
  | "parentId"
  | "fullAccess"
  | "githubUserToken"
  | "githubAppScope"
  | "check"
>;

export interface CardLabel {
  title: string;
  subtitle: string;
}

const capitalized = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

const named = (name: string) => `named ${name}`;

function reachOf(
  connection: ChildFields,
): { title: string; detail: string } | null {
  if (connection.fullAccess)
    return match(githubCredentialKind(connection))
      .with("installation", () => ({
        title: "The whole installation",
        detail: "All permissions",
      }))
      .with("sign-in", () => ({
        title: "Everything the app can reach, on every account",
        detail: "All accounts",
      }))
      .exhaustive();
  const userScope = connection.githubUserToken?.scope;
  if (userScope)
    return {
      title: `${userScope.targetLogin ?? `account ${userScope.targetId}`} / ${repositoriesPhrase(
        userScope.repositoryNames,
        userScope.repositoryIds?.length ?? 0,
      )}`,
      detail: capitalized(permissionsPhrase(userScope.permissions, "count")),
    };
  const appScope = connection.githubAppScope;
  if (!appScope) return null;
  const idCount = appScope.repositoryIds?.length ?? 0;
  const repositories = repositoriesPhrase(
    appScope.repositories ??
      (idCount > 0 ? connection.check?.repositories : undefined),
    idCount,
  );
  const installedOn = connection.check?.installedOn;
  return {
    title: installedOn
      ? `${installedOn} / ${repositories}`
      : capitalized(repositories),
    detail: capitalized(permissionsPhrase(appScope.permissions, "count")),
  };
}

export function childCardLabel(connection: ChildFields): CardLabel | null {
  if (!connection.parentId) return null;
  const reach = reachOf(connection);
  if (!reach) return null;
  return {
    title: reach.title,
    subtitle: `${reach.detail} · ${named(connection.name)}`,
  };
}

type ParentFields = Pick<
  ConnectionView,
  | "id"
  | "name"
  | "templateId"
  | "authKind"
  | "status"
  | "accountLabel"
  | "appSlug"
  | "check"
>;

function presetAppSlug(
  template: Pick<ConnectionTemplateView, "inputs" | "extras"> | undefined,
): string | undefined {
  const fromExtras = template?.extras?.appSlug;
  if (typeof fromExtras === "string") return fromExtras;
  return template?.inputs.find((input) => input.name === "appSlug")
    ?.presetValue;
}

export function signInAppLabel(
  parent: Pick<ParentFields, "appSlug">,
  template: Pick<ConnectionTemplateView, "inputs" | "extras"> | undefined,
): string | undefined {
  if (!parent.appSlug) return undefined;
  return parent.appSlug === presetAppSlug(template)
    ? `${getBrand().name} app`
    : `${parent.appSlug} app`;
}

function installationAppName(parent: ParentFields): string | undefined {
  const account = parent.check?.account;
  return account?.endsWith("[bot]") ? account.slice(0, -5) : undefined;
}

function plainTitle(parent: ParentFields): string {
  return match(githubCredentialKind(parent))
    .with(
      "installation",
      () => installationAppName(parent) ?? "Your GitHub App",
    )
    .with("sign-in", () =>
      parent.accountLabel
        ? parent.accountLabel
        : parent.status === "pending"
          ? "GitHub sign-in"
          : parent.name,
    )
    .exhaustive();
}

export function parentCardLead(
  parent: Pick<ParentFields, "name" | "authKind" | "templateId">,
): string {
  return match(githubCredentialKind(parent))
    .with("installation", () => `Your own app · ${named(parent.name)}`)
    .with("sign-in", () =>
      parent.templateId === "github-enterprise"
        ? "Signed in with GitHub Enterprise"
        : "Signed in with GitHub",
    )
    .exhaustive();
}

export function parentCardTitles(
  parents: readonly ParentFields[],
  templateById: ReadonlyMap<
    string,
    Pick<ConnectionTemplateView, "inputs" | "extras">
  >,
): Map<string, string> {
  const plain = new Map(parents.map((p) => [p.id, plainTitle(p)]));
  const appOf = (p: ParentFields) =>
    githubCredentialKind(p) === "sign-in"
      ? signInAppLabel(p, templateById.get(p.templateId))
      : undefined;
  const sharing = (p: ParentFields) =>
    parents.filter((other) => plain.get(other.id) === plain.get(p.id));
  return new Map(
    parents.map((p) => {
      const title = plain.get(p.id) ?? p.name;
      const same = sharing(p);
      if (same.length < 2) return [p.id, title];
      const app = appOf(p);
      const appIsShared = same.some(
        (other) => other.id !== p.id && appOf(other) === app,
      );
      return [p.id, `${title} · ${app && !appIsShared ? app : p.name}`];
    }),
  );
}

export interface CardFix {
  label: string;
  run: () => void;
}

export interface ParentRepair {
  badge: string;
  fix?: CardFix;
  paused: string;
}

const fixOf = (
  label: string,
  run: (() => void) | undefined,
): CardFix | undefined => (run ? { label, run } : undefined);

export function parentRepair(
  parent: Pick<ConnectionView, "status" | "authKind" | "retiredHost">,
  maintenance: RowMaintenanceActions | undefined,
): ParentRepair | null {
  if (parent.status === "active") return null;
  if (parent.status === "disconnected") {
    const fix = fixOf("Move to another host", maintenance?.onMoveHost);
    return {
      badge: parent.retiredHost ? "Host retired" : "Disconnected",
      fix,
      paused: fix ? "Paused until you move it to another host" : "Paused",
    };
  }
  const pending = parent.status === "pending";
  const badge = pending ? "Not finished" : "Expired";
  return match(githubCredentialKind(parent))
    .with("installation", () => ({
      badge,
      fix: fixOf("Add a new key", maintenance?.onUpdateCredential),
      paused: "Paused until you add a new key",
    }))
    .with("sign-in", () =>
      pending
        ? {
            badge,
            fix: fixOf("Sign in", maintenance?.onReauthenticate),
            paused: "Paused until you sign in",
          }
        : {
            badge,
            fix: fixOf("Sign in again", maintenance?.onReauthenticate),
            paused: "Paused until you sign in again",
          },
    )
    .exhaustive();
}

export const REFUSED_ACCESS = "GitHub refused this access";

export function childRepair(
  child: Pick<ConnectionView, "status">,
  maintenance: RowMaintenanceActions | undefined,
): CardFix | null {
  if (child.status !== "expired") return null;
  return (
    fixOf(
      "Choose access again",
      maintenance?.onEditScope ?? maintenance?.onReauthenticate,
    ) ?? null
  );
}
