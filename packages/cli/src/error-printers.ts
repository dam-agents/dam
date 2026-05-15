/**
 * Shared stderr renderers for the error shapes every networked verb meets:
 * compat-resolve failures, config-resolve failures, and instance-resolve
 * failures. Lives at the package level (alongside result.ts) because the
 * underlying errors come from multiple modules and the rendering is a
 * command-layer concern, not a service-layer one.
 *
 * Exit-code mapping stays per-command (each module has its own
 * `EXIT_<MOD>_RUNTIME_FAILURE`), so callers decide how to translate the
 * non-resolved variants into their own exit codes.
 */

import type {
  AuthRequiredError,
  ResolveError,
  TransportError,
} from "./modules/instances/index.js";

interface CompatResolveErrorShape {
  kind: string;
  reason?: string;
  code?: string;
  message?: string;
}

interface ConfigErrorShape {
  kind: string;
  reason?: string;
}

export function printCompatResolveError(
  e: CompatResolveErrorShape,
  serverEnvVar: string,
): void {
  switch (e.kind) {
    case "missing-config":
      process.stderr.write(
        `error: no server configured; run "dam config set server <url>" or set ${serverEnvVar}\n`,
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

export function describeConfigError(e: ConfigErrorShape): string {
  if (e.kind === "malformed-config") return e.reason ?? "config is malformed";
  return "no server configured";
}

/** Renders the full ResolveError union. Verbs whose call sites can only
 *  produce a subset (e.g. `instances list` returns only transport / auth)
 *  pass that subset through — it widens cleanly. */
export function printResolveError(
  error: ResolveError | TransportError | AuthRequiredError,
): void {
  switch (error.kind) {
    case "not-found":
      if (error.via === "id") {
        process.stderr.write(`error: no instance with id '${error.ref}'\n`);
      } else {
        process.stderr.write(`error: no instance named '${error.ref}'\n`);
      }
      return;
    case "ambiguous":
      process.stderr.write(`error: multiple instances named '${error.ref}':\n`);
      for (const m of error.matches) process.stderr.write(`  ${m.id}\n`);
      process.stderr.write("specify by id instead.\n");
      return;
    case "auth-required":
      process.stderr.write(
        `error: not authenticated: ${error.reason}\n` +
          `       run "dam auth login" first\n`,
      );
      return;
    case "transport":
      process.stderr.write(`error: cannot reach server: ${error.reason}\n`);
      return;
  }
}

/** True for `not-found` and `ambiguous` — the cases that map to
 *  EXIT_INSTANCE_NOT_RESOLVED. All other variants are runtime failures. */
export function isInstanceNotResolved(error: ResolveError): boolean {
  return error.kind === "not-found" || error.kind === "ambiguous";
}
