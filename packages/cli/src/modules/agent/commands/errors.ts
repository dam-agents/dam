import type { AgentView } from "../domain/agent-view.js";
import {
  createAgentResolver,
  type ResolveError,
} from "../services/agent-resolver.js";
import type { AgentService } from "../services/agent-service.js";
import {
  EXIT_AGENT_NOT_RESOLVED,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";
import { printServiceError } from "../../shared/trpc/print.js";

function exitCodeForResolveError(error: ResolveError): number {
  return error.kind === "not-found" || error.kind === "ambiguous"
    ? EXIT_AGENT_NOT_RESOLVED
    : EXIT_RUNTIME_FAILURE;
}

function printResolveError(error: ResolveError, host: string): void {
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
    case "transport":
      printServiceError(error, host);
      return;
  }
}

export async function resolveAgentOrExit(
  agentService: AgentService,
  ref: string,
  host: string,
): Promise<AgentView> {
  const resolved = await createAgentResolver({ agentService }).resolve(ref);
  if (!resolved.ok) {
    printResolveError(resolved.error, host);
    process.exit(exitCodeForResolveError(resolved.error));
  }
  return resolved.value;
}
