import type { AgentView } from "../domain/agent-view.js";
import { resolveAgent, type ResolveError } from "../services/agent-resolver.js";
import type { AgentService } from "../services/agent-service.js";
import {
  EXIT_AGENT_NOT_REACHABLE,
  EXIT_AGENT_NOT_RESOLVED,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";
import {
  exitOnServiceError,
  printTrpcError,
  serviceErrorDescription,
  type ErrorDescription,
} from "../../shared/trpc/print.js";
import {
  AgentUnavailableAtTransportError,
  NonJsonAnswerAtTransportError,
} from "../../shared/trpc/trpc-client.js";
import { startFailure } from "./wait-or-exit.js";

export function describeResolveError(
  error: ResolveError,
  host: string,
): ErrorDescription {
  switch (error.kind) {
    case "not-found":
      return {
        stderr:
          error.via === "id"
            ? `error: no agent with id \`${error.ref}\`\n`
            : `error: no agent named "${error.ref}"\n`,
        exitCode: EXIT_AGENT_NOT_RESOLVED,
      };
    case "ambiguous":
      return {
        stderr:
          `error: multiple agents named "${error.ref}":\n` +
          error.matches.map((m) => `  - \`${m.id}\`\n`).join("") +
          "hint: specify by id instead\n",
        exitCode: EXIT_AGENT_NOT_RESOLVED,
      };
    case "auth-required":
    case "transport":
      return serviceErrorDescription(error, host);
  }
}

export async function resolveAgentOrExit(
  agentService: AgentService,
  ref: string,
  host: string,
): Promise<AgentView> {
  const resolved = await resolveAgent(agentService, ref);
  exitOnServiceError(resolved, host, describeResolveError);
  return resolved.value;
}

function unavailableCause(
  e: unknown,
): AgentUnavailableAtTransportError | NonJsonAnswerAtTransportError | null {
  for (let c = e, depth = 0; c && depth < 8; depth++) {
    if (c instanceof AgentUnavailableAtTransportError) return c;
    if (c instanceof NonJsonAnswerAtTransportError && c.status >= 500) return c;
    c = (c as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A call through an agent that the api-server
 * could not wake, or that a gateway in front of it answered with its own
 * error page, says why the agent could not start and exits with the
 * agent-not-reachable code. The server's own sentence wins; without one, the
 * agent's current state supplies it, as the web app shows it.
 */
export async function exitOnAgentCallError(
  e: unknown,
  agentService: AgentService,
  agent: Pick<AgentView, "id" | "name">,
  host: string,
): Promise<never> {
  const unavailable = unavailableCause(e);
  if (unavailable === null) {
    printTrpcError(e, host);
    return process.exit(EXIT_RUNTIME_FAILURE);
  }
  const why =
    (unavailable instanceof AgentUnavailableAtTransportError
      ? unavailable.reason
      : undefined) ?? (await startFailure(agentService, agent.id));
  process.stderr.write(
    why
      ? `error: agent "${agent.name}" could not start: ${why}\n`
      : `error: ${unavailable.message}\n`,
  );
  return process.exit(EXIT_AGENT_NOT_REACHABLE);
}
