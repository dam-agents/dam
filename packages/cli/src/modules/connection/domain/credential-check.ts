import type { CredentialCheck } from "api-server-api";

export function credentialCheckWarning(
  name: string,
  check: CredentialCheck | undefined,
): string | null {
  if (!check || check.status === "passed") return null;
  const what =
    check.status === "failed"
      ? "failed its check"
      : "was saved without a check";
  return (
    `warning: ${name} ${what}${check.reason ? `: ${check.reason}` : ""}.\n` +
    `  Replace it with \`dam connection update ${name}\`, or check it again with \`dam connection test ${name}\`.\n`
  );
}

export function credentialCheckSummary(check: CredentialCheck): string {
  if (check.status !== "passed") {
    return `${check.status}${check.reason ? `: ${check.reason}` : ""}`;
  }
  const details = [
    check.account ? `as ${check.account}` : null,
    check.expiresAt ? `expires ${check.expiresAt.slice(0, 10)}` : null,
    check.scopes ? `scopes ${check.scopes.join(",") || "none"}` : null,
  ].filter((d): d is string => d !== null);
  return details.length > 0 ? `passed (${details.join("; ")})` : "passed";
}
