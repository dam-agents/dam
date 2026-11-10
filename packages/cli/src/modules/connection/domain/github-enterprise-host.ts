import type { ConnectionTemplateView } from "api-server-api";

const GITHUB_ENTERPRISE_SIGN_IN = "github-enterprise";

// UNIT_BOUNDARY_DESCRIPTION: the GitHub Enterprise hosts an install offers for a sign-in, read from the template view, retired ones already left out by the server. A sign-in may only be made on one of them; a server that sends no list leaves the host input as it always was.
export function offeredHostsOf(
  template: Pick<ConnectionTemplateView, "id" | "extras">,
): readonly string[] {
  if (template.id !== GITHUB_ENTERPRISE_SIGN_IN) return [];
  const raw = template.extras?.hostChoices;
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is string => typeof h === "string");
}

export function hostnameOf(raw: string): string {
  const trimmed = raw.trim();
  try {
    return new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    ).hostname.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

export function offeredHostsLine(hosts: readonly string[]): string {
  return `offered hosts: ${hosts.join(", ")}`;
}
