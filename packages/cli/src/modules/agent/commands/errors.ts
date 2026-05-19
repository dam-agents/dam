import type { AuthRequiredError, TransportError } from "../domain/errors.js";
import type { ResolveError } from "../services/agent-resolver.js";
import {
  EXIT_AGENT_RUNTIME_FAILURE,
  EXIT_AGENT_NOT_RESOLVED,
} from "./exit-codes.js";

export function formatTransportError(reason: string, host: string): string {
  return `cannot reach server \`${host}\`: ${reason}`;
}

export function exitCodeForResolveError(error: ResolveError): number {
  return error.kind === "not-found" || error.kind === "ambiguous"
    ? EXIT_AGENT_NOT_RESOLVED
    : EXIT_AGENT_RUNTIME_FAILURE;
}

export function printServiceError(
  error: TransportError | AuthRequiredError,
  host: string,
): void {
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
        process.stderr.write(`error: no agent with id \`${error.ref}\`\n`);
      } else {
        process.stderr.write(`error: no agent named "${error.ref}"\n`);
      }
      return;
    case "ambiguous":
      process.stderr.write(`error: multiple agents named "${error.ref}":\n`);
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
      process.stderr.write(
        `error: ${formatTransportError(error.reason, host)}\n`,
      );
      return;
  }
}
