/**
 * Shared stderr formatting for `instance` command actions.
 *
 * Three families of error all flow through the same pre-flight skeleton
 * (compat probe → config resolve → service call), so the message helpers
 * live here once instead of duplicated per verb. Wording follows the
 * locked CLI UX conventions: tokens in backticks, user-typed strings in
 * double quotes, `hint:` for next-step suggestions, `error: ` prefix
 * already implied by the helpers (so messages start lowercase).
 */

import type { ResolveError } from "../services/instance-resolver.js";
import {
  EXIT_INSTANCE_RUNTIME_FAILURE,
  EXIT_INSTANCE_NOT_RESOLVED,
} from "./exit-codes.js";

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

/** Standard exit code for an `InstanceResolver` failure: 5 when the
 *  ref didn't pin down a single instance, runtime-failure otherwise. */
export function exitCodeForResolveError(error: ResolveError): number {
  if (error.kind === "not-found" || error.kind === "ambiguous") {
    return EXIT_INSTANCE_NOT_RESOLVED;
  }
  return EXIT_INSTANCE_RUNTIME_FAILURE;
}

/** Standard stderr renderer for an `InstanceResolver` failure. Shares
 *  the wording across every verb that takes an instance ref. */
export function printResolveError(error: ResolveError, host: string): void {
  switch (error.kind) {
    case "not-found":
      if (error.via === "id") {
        process.stderr.write(`error: no instance with id \`${error.ref}\`\n`);
      } else {
        process.stderr.write(`error: no instance named "${error.ref}"\n`);
      }
      return;
    case "ambiguous":
      process.stderr.write(`error: multiple instances named "${error.ref}":\n`);
      for (const m of error.matches) {
        process.stderr.write(`  - \`${m.id}\`\n`);
      }
      process.stderr.write("hint: specify by id instead\n");
      return;
    case "auth-required":
      process.stderr.write(`error: not authenticated: ${error.reason}\n`);
      process.stderr.write("hint: run `dam auth login` first\n");
      return;
    case "transport":
      process.stderr.write(`error: ${formatTransportError(error.reason, host)}\n`);
      return;
  }
}
