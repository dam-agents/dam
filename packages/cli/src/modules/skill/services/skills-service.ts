import type { Skill, SkillRef, SkillSource } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import { classifyTrpcError, trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type {
  AgentNotReachableError,
  AuthRequiredError,
  PrivateSourceNeedsAgentError,
  SourceNeedsConnectionError,
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
      | SourceNeedsConnectionError
    >
  >;

  /** skills.state(agentId).installed — the installed inventory only. */
  installed(
    agentId: string,
  ): Promise<Result<readonly SkillRef[], TransportError | AuthRequiredError>>;

  /** skills.install — source is the git URL; version/contentHash come from a
   *  prior scan. Always sends an agentId, so it can hit the wake path but
   *  never the private-source case. Returns the updated installed refs. */
  install(input: {
    agentId: string;
    source: string;
    name: string;
    version: string;
    contentHash?: string;
  }): Promise<
    Result<
      readonly SkillRef[],
      TransportError | AuthRequiredError | AgentNotReachableError
    >
  >;

  /** skills.uninstall — keys on (source git URL, name). Idempotent. */
  uninstall(input: {
    agentId: string;
    source: string;
    name: string;
  }): Promise<
    Result<
      readonly SkillRef[],
      TransportError | AuthRequiredError | AgentNotReachableError
    >
  >;
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
        // With an agentId, the pod was reached but GitHub may have refused: the
        // server encodes a `platform-cta:` fix-it URL in the message for the
        // app-not-connected / access-restricted case. Surface that distinctly
        // (mirroring the UI) rather than as an unreachable-agent failure.
        const cta = (e instanceof Error ? e.message : "").match(
          /platform-cta:(\S+)/,
        )?.[1];
        if (cta !== undefined) {
          const message = (e as Error).message
            .replace(/\nplatform-cta:\S+/, "")
            .trim();
          return err({ kind: "source-needs-connection", message, cta });
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
    async install(input) {
      try {
        const refs = (await deps.trpc.skills.install.mutate(
          input,
        )) as readonly SkillRef[];
        return ok(refs);
      } catch (e) {
        return classifyWakeError(e);
      }
    },
    async uninstall(input) {
      try {
        const refs = (await deps.trpc.skills.uninstall.mutate(
          input,
        )) as readonly SkillRef[];
        return ok(refs);
      } catch (e) {
        return classifyWakeError(e);
      }
    },
  };
}
