import {
  type CredentialCheck,
  credentialExpiresSoon,
  type SecretRequestDestination,
  type SecretRequestView,
} from "api-server-api";

import { parentNoun } from "./connection-hierarchy.js";
import { appScopePhrase, fullAccessLine } from "./github-access.js";

export function readSecretRequestId(search: string): string | null {
  const id = new URLSearchParams(search).get("request");
  return id && id.length > 0 ? id : null;
}

export function destinationLabel(d: SecretRequestDestination): string {
  return d.port ? `${d.host}:${d.port}` : d.host;
}

export function destinationDetail(d: SecretRequestDestination): string {
  if (d.signed) return "requests signed with the key pair";
  if (d.headerName && d.valueFormat) {
    return `${d.headerName}: ${d.valueFormat.replace("{value}", "<secret>")}`;
  }
  return "";
}

export function secretRequestErrorCopy(code: string | undefined): {
  title: string;
  hint: string;
} {
  switch (code) {
    case "FORBIDDEN":
      return {
        title: "This link belongs to another user",
        hint: "Sign in as the user who ran the command, or run it again yourself. Never enter a secret on a link someone else sent you.",
      };
    case "NOT_FOUND":
      return {
        title: "This link has expired or was already used",
        hint: "Run the command again to get a new link.",
      };
    default:
      return {
        title: "This link can't be opened",
        hint: "Run the command again to get a new link.",
      };
  }
}

export function credentialCheckDetails(check: CredentialCheck): string[] {
  const details: string[] = [];
  if (check.account) details.push(`Account: ${check.account}`);
  if (check.installedOn) details.push(`Installed on: ${check.installedOn}`);
  if (check.repositories) {
    details.push(
      `Repositories: ${check.repositories.length > 0 ? check.repositories.join(", ") : "none"}${check.repositoriesTruncated ? ", …" : ""}`,
    );
  }
  if (check.expiresAt) {
    details.push(
      `Expires: ${new Date(check.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
    );
  }
  if (check.scopes) {
    details.push(
      `Scopes: ${check.scopes.length > 0 ? check.scopes.join(", ") : "none"}`,
    );
  }
  return details;
}

export function heldCheckCopy(check: CredentialCheck): {
  title: string;
  hint: string;
} {
  if (check.status === "passed" && credentialExpiresSoon(check)) {
    return {
      title: "This secret expires within a day",
      hint: "Agents that use it will be refused once it expires. Enter a longer-lived secret above, or save it anyway.",
    };
  }
  return check.status === "failed"
    ? {
        title: "This secret did not pass the check",
        hint: "Agents that use it will be refused. Fix the secret above, or save it anyway.",
      }
    : {
        title: "The secret could not be checked",
        hint: "The service did not say whether the secret works. Try again, or save it anyway.",
      };
}

export type SecretRequestReach =
  | { kind: "full-access"; text: string }
  | { kind: "scope"; text: string }
  | { kind: "installation-only" };

export function secretRequestReach(
  view: Pick<SecretRequestView, "action" | "authKind" | "githubAppAccess">,
): SecretRequestReach | null {
  if (view.action !== "create" || view.authKind !== "github-app") return null;
  const access = view.githubAppAccess;
  if (access?.fullAccess)
    return { kind: "full-access", text: fullAccessLine(view) };
  const narrowed =
    (access?.repositories?.length ?? 0) > 0 ||
    (access?.repositoryIds?.length ?? 0) > 0 ||
    Object.keys(access?.permissions ?? {}).length > 0;
  if (!access || !narrowed) return { kind: "installation-only" };
  return { kind: "scope", text: appScopePhrase(access) };
}

type SubjectView = Pick<
  SecretRequestView,
  "action" | "authKind" | "githubAppAccess" | "isParent"
>;

export function savesParentOnly(view: SubjectView): boolean {
  return (
    view.isParent === true ||
    secretRequestReach(view)?.kind === "installation-only"
  );
}

export function secretRequestSubjectLabel(view: SubjectView): string {
  return savesParentOnly(view) ? parentNoun(view) : "Connection";
}

export function secretRequestUsedBy(
  view: SubjectView & Pick<SecretRequestView, "grantedAgents" | "requestedBy">,
): { label: string; text: string } {
  if (view.action === "update")
    return {
      label: view.isParent ? "Used by (through its connections)" : "Used by",
      text:
        view.grantedAgents.length > 0
          ? view.grantedAgents.map((a) => a.name).join(", ")
          : "no agent yet",
    };
  if (savesParentOnly(view))
    return {
      label: "Used by",
      text: "no agent until you make a connection from it",
    };
  return {
    label: "Used by",
    text: view.requestedBy
      ? `${view.requestedBy.name}, once you save`
      : "no agent until you grant it",
  };
}

export function grantFailedCopy(view: SubjectView): string {
  if (!savesParentOnly(view))
    return "The agent that asked for it did not get it. Grant the connection in the agent's Connections section.";
  const noun = parentNoun(view);
  return `The agent that asked for it did not get it: an agent never holds a ${noun} itself. Make a connection from the ${noun} on the Connections page, then add that connection to the agent.`;
}
