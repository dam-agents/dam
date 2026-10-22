import type { SecretRequestDestination } from "api-server-api";

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
