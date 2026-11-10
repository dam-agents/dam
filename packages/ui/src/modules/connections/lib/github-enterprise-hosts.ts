import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

const GITHUB_ENTERPRISE_SIGN_IN = "github-enterprise";

// UNIT_BOUNDARY_DESCRIPTION: the GitHub Enterprise hosts the install offers, read from the template view, retired ones left out. A sign-in may move to any of them, and the connect form offers each of them, even the only one, beside a host of the user's own.
export function offeredHostsOf(
  template: Pick<ConnectionTemplateView, "extras"> | undefined,
): string[] {
  const raw = template?.extras?.hostChoices;
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is string => typeof h === "string");
}

export const ANOTHER_HOST = "another";

// UNIT_BOUNDARY_DESCRIPTION: with the github-enterprise-hosts feature on, a GitHub Enterprise sign-in's host is always picked in the form, from the offered hosts or "Another host…". An offered host signs in with its own app; another host has none the platform registered, so the user brings theirs: the host, client ID and client secret become required, and the template's preset app is no longer sent.
export function withHostPicked(
  template: ConnectionTemplateView,
  anotherHost: boolean,
): ConnectionTemplateView {
  return {
    ...template,
    inputs: template.inputs.map((input) => {
      if (input.name === "host")
        return {
          ...input,
          state: "required",
          ...(anotherHost ? { presetValue: undefined } : {}),
        };
      if (
        anotherHost &&
        (input.name === "clientId" || input.name === "clientSecret")
      )
        return { ...input, state: "required", presetValue: undefined };
      return input;
    }),
  };
}

export function picksGitHubEnterpriseHost(
  template: Pick<
    ConnectionTemplateView,
    "id" | "authKind" | "inputs" | "extras"
  >,
  hostsEnabled: boolean,
): boolean {
  return (
    hostsEnabled &&
    template.id === GITHUB_ENTERPRISE_SIGN_IN &&
    template.authKind === "oauth" &&
    template.inputs.some((i) => i.name === "host") &&
    offeredHostsOf(template).length > 0
  );
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
  const current = connection.host?.trim().toLowerCase();
  return choices.filter((h) => h.toLowerCase() !== current);
}

export function retiredHostNote(
  connection: Pick<ConnectionView, "retiredHost" | "parentId"> &
    Partial<Pick<ConnectionView, "templateId" | "authKind">>,
): string | undefined {
  const host = connection.retiredHost;
  if (!host) return undefined;
  if (connection.parentId && connection.authKind === "oauth")
    return `${host} is retired. Move the sign-in this connection was made from.`;
  if (movesBetweenHosts(connection as ConnectionView))
    return `${host} is retired. Move this sign-in to another host.`;
  return `${host} is retired. Make a new one on another host, then remove this one.`;
}
