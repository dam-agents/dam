import { SERVER_ENV_VAR } from "../../cli/index.js";
import type { AuthRequiredError, TransportError } from "../domain/errors.js";
import type { ResolveError } from "../services/instance-resolver.js";
import { EXIT_INSTANCE_RUNTIME_FAILURE, EXIT_INSTANCE_NOT_RESOLVED } from "./exit-codes.js";

export function describeConfigError(e: { kind: string; reason?: string }): string {
  if (e.kind === "malformed-config") return e.reason ?? "config is malformed";
  return "no server configured";
}

export function printCompatResolveError(
  e: { kind: string; reason?: string; code?: string; message?: string },
): void {
  switch (e.kind) {
    case "missing-config":
      process.stderr.write(`error: no server configured; run \`dam config set server <url>\` or set \`${SERVER_ENV_VAR}\`\n`);
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

export function formatTransportError(reason: string, host: string): string {
  return `cannot reach server \`${host}\`: ${reason}`;
}

export function exitCodeForResolveError(error: ResolveError): number {
  return (error.kind === "not-found" || error.kind === "ambiguous") ? EXIT_INSTANCE_NOT_RESOLVED : EXIT_INSTANCE_RUNTIME_FAILURE;
}

export function printServiceError(error: TransportError | AuthRequiredError, host: string): void {
  if (error.kind === "auth-required") {
    process.stderr.write(`error: not authenticated: ${error.reason}\n`);
    process.stderr.write("hint: run `dam auth login` first\n");
    return;
  }
  process.stderr.write(`error: ${formatTransportError(error.reason, host)}\n`);
}

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
