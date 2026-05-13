/**
 * Shared stderr formatting for `instances` command actions.
 *
 * Three families of error all flow through the same pre-flight skeleton
 * (compat probe → config resolve → service call), so the message helpers
 * live here once instead of duplicated per verb. Wording follows the
 * locked CLI UX conventions: tokens in backticks, user-typed strings in
 * double quotes, `hint:` for next-step suggestions, `error: ` prefix
 * already implied by the helpers (so messages start lowercase).
 */

export function describeConfigError(e: { kind: string; reason?: string }): string {
  if (e.kind === "malformed-config") return e.reason ?? "config is malformed";
  return "no server configured";
}

export function printCompatResolveError(
  e: { kind: string; reason?: string; code?: string; message?: string },
  serverEnvVar: string,
): void {
  switch (e.kind) {
    case "missing-config":
      process.stderr.write(
        `error: no server configured; run \`dam config set server <url>\` or set \`${serverEnvVar}\`\n`,
      );
      return;
    case "malformed-config":
      process.stderr.write(`error: ${e.reason ?? "config malformed"}\n`);
      return;
    case "probe-error":
      process.stderr.write(`error: cannot reach server: ${e.message ?? e.code ?? "unknown"}\n`);
      return;
    default:
      process.stderr.write(`error: ${e.kind}\n`);
  }
}

/** Canonical transport-error format used by every command that talks to
 *  the api-server after the config has already resolved a host. The host
 *  comes from the resolved config so the user sees which server failed. */
export function formatTransportError(reason: string, host: string): string {
  return `cannot reach server \`${host}\`: ${reason}`;
}
