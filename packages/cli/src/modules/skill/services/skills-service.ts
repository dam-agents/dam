import type { Skill, SkillRef, SkillSource } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import { classifyTrpcError, trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type {
  AgentNotReachableError,
  AuthRequiredError,
  PrivateSourceNeedsAgentError,
  TransportError,
} from "../domain/errors.js";

export interface SkillsService {
  /** sources.list(agentId?) — User/Platform/Agent sources. */
  listSources(
    agentId?: string,
  ): Promise<
    Result<readonly SkillSource[], TransportError | AuthRequiredError>
  >;

  /** skills.list(sourceId, agentId?) — scan one source. Disambiguates the two
   *  meanings of PRECONDITION_FAILED by whether agentId was passed. */
  catalog(
    sourceId: string,
    agentId?: string,
  ): Promise<
    Result<
      readonly Skill[],
      | TransportError
      | AuthRequiredError
      | AgentNotReachableError
      | PrivateSourceNeedsAgentError
    >
  >;

  /** skills.state(agentId).installed — the installed inventory only. */
  installed(
    agentId: string,
  ): Promise<Result<readonly SkillRef[], TransportError | AuthRequiredError>>;
}

/**
 * Map a tRPC error from a wake-path call (one that sent an agentId) to the
 * reachability error: `ensureAgentReachable` raises PRECONDITION_FAILED for an
 * error-state agent and INTERNAL_SERVER_ERROR on a wake-to-ready timeout.
 * Anything else is plain transport/auth.
 */
function classifyWakeError(
  e: unknown,
): Result<never, TransportError | AuthRequiredError | AgentNotReachableError> {
  const code = (e as { data?: { code?: string } })?.data?.code;
  if (code === "PRECONDITION_FAILED" || code === "INTERNAL_SERVER_ERROR") {
    return err({
      kind: "agent-not-reachable",
      reason: e instanceof Error ? e.message : String(e),
    });
  }
  return classifyTrpcError(e);
}

export function createSkillsService(deps: { trpc: TrpcClient }): SkillsService {
  return {
    async listSources(agentId) {
      return trpcCall(
        () =>
          deps.trpc.skills.sources.list.query(
            agentId ? { agentId } : undefined,
          ) as Promise<readonly SkillSource[]>,
      );
    },
    async catalog(sourceId, agentId) {
      try {
        const skills = (await deps.trpc.skills.list.query({
          sourceId,
          agentId,
        })) as readonly Skill[];
        return ok(skills);
      } catch (e) {
        // Without an agentId, a PRECONDITION_FAILED means the source is
        // private/non-GitHub and needs a pod to scan — not a wake failure.
        if (agentId === undefined) {
          const code = (e as { data?: { code?: string } })?.data?.code;
          if (code === "PRECONDITION_FAILED")
            return err({ kind: "private-source-needs-agent" });
          return classifyTrpcError(e);
        }
        return classifyWakeError(e);
      }
    },
    async installed(agentId) {
      return trpcCall(
        async () =>
          (await deps.trpc.skills.state.query({ agentId }))
            .installed as readonly SkillRef[],
      );
    },
  };
}
