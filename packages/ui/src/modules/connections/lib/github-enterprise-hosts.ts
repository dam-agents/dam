import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

const GITHUB_ENTERPRISE_SIGN_IN = "github-enterprise";

// UNIT_BOUNDARY_DESCRIPTION: the GitHub Enterprise hosts the install offers, read from the template view. A pick is only worth offering when there are two or more, so one host or none reads as no choice.
export function hostChoicesOf(
  template: Pick<ConnectionTemplateView, "extras"> | undefined,
): string[] {
  const raw = template?.extras?.hostChoices;
  if (!Array.isArray(raw)) return [];
  const hosts = raw.filter((h): h is string => typeof h === "string");
  return hosts.length > 1 ? hosts : [];
}

export function gheSignInHostChoices(
  templates: readonly ConnectionTemplateView[],
): string[] {
  return hostChoicesOf(
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
