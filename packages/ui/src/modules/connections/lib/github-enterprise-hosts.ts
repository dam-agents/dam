import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

const GITHUB_ENTERPRISE_SIGN_IN = "github-enterprise";

// UNIT_BOUNDARY_DESCRIPTION: the GitHub Enterprise hosts the install offers, read from the template view, retired ones left out. A sign-in may move to any of them, even the only one; the connect form only asks when there are two or more, so one host or none reads as no choice there.
export function offeredHostsOf(
  template: Pick<ConnectionTemplateView, "extras"> | undefined,
): string[] {
  const raw = template?.extras?.hostChoices;
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is string => typeof h === "string");
}

export function hostChoicesOf(
  template: Pick<ConnectionTemplateView, "extras"> | undefined,
): string[] {
  const hosts = offeredHostsOf(template);
  return hosts.length > 1 ? hosts : [];
}

export function gheSignInOfferedHosts(
  templates: readonly ConnectionTemplateView[],
): string[] {
  return offeredHostsOf(
    templates.find((t) => t.id === GITHUB_ENTERPRISE_SIGN_IN),
  );
}

export function movesBetweenHosts(connection: ConnectionView): boolean {
  return (
    connection.templateId === GITHUB_ENTERPRISE_SIGN_IN &&
    connection.authKind === "oauth" &&
    !connection.parentId
  );
}

export function otherHosts(
  choices: readonly string[],
  connection: Pick<ConnectionView, "host">,
): string[] {
  return choices.filter((h) => h !== connection.host);
}

export function retiredHostNote(
  connection: Pick<ConnectionView, "retiredHost" | "parentId"> &
    Partial<Pick<ConnectionView, "templateId" | "authKind">>,
): string | undefined {
  const host = connection.retiredHost;
  if (!host) return undefined;
  if (connection.parentId)
    return `${host} is retired. Move the sign-in this connection was made from.`;
  if (movesBetweenHosts(connection as ConnectionView))
    return `${host} is retired. Move this sign-in to another host.`;
  return `${host} is retired. Make a new one on another host, then remove this one.`;
}
