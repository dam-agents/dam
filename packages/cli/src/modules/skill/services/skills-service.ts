import type {
  Skill,
  SkillPublishResult,
  SkillRef,
  SkillsState,
  SkillSource,
} from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import { classifyTrpcError, trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type {
  AgentNotReachableError,
  AuthRequiredError,
  PrivateSourceNeedsAgentError,
  PublishFailedError,
  PublishNeedsConnectionError,
  SourceAlreadyExistsError,
  SourceNeedsConnectionError,
  SourceNotFoundError,
  TransportError,
} from "../domain/errors.js";

export interface SkillsService {
  /** sources.list(agentId?) — User/Platform/Agent sources. */
  listSources(
    agentId?: string,
  ): Promise<
    Result<readonly SkillSource[], TransportError | AuthRequiredError>
  >;

  /** sources.create — register a User source. A CONFLICT (the gitUrl is
   *  already one of yours) maps to source-exists. */
  addSource(input: {
    name: string;
    gitUrl: string;
  }): Promise<
    Result<
      SkillSource,
      TransportError | AuthRequiredError | SourceAlreadyExistsError
    >
  >;

  /** sources.delete — untrack a User source. Protected sources are rejected in
   *  the command before this is reached, so no FORBIDDEN mapping is needed. */
  removeSource(
    id: string,
  ): Promise<Result<void, TransportError | AuthRequiredError>>;

  /** sources.refresh — drop the source's scan cache. A NOT_FOUND (raced with a
   *  delete) maps to source-not-found. */
  refreshSource(
    id: string,
  ): Promise<
    Result<void, TransportError | AuthRequiredError | SourceNotFoundError>
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

  /** skills.state(agentId) — the full reconciled view: installed refs,
   *  standalone (on-disk, untracked) skills, and publish records. */
  state(
    agentId: string,
  ): Promise<Result<SkillsState, TransportError | AuthRequiredError>>;

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

  /** skills.publish — opens a GitHub PR for a standalone skill. Keys on the
   *  source `id` (unlike install/uninstall, which key on the git URL). The
   *  pod is woken server-side (ADR-032); the CLI surfaces only the residual
   *  failures. */
  publish(input: {
    agentId: string;
    sourceId: string;
    name: string;
    title?: string;
    body?: string;
  }): Promise<
    Result<
      SkillPublishResult,
      | TransportError
      | AuthRequiredError
      | AgentNotReachableError
      | PublishNeedsConnectionError
      | PublishFailedError
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

/**
 * Map a `skills.publish` failure to a clean error. More granular than
 * `classifyWakeError` because publish's INTERNAL_SERVER_ERROR is overloaded:
 * both a wake-to-ready timeout and a relayed GitHub 5xx land on it, so it's
 * disambiguated by message rather than treated as unreachable wholesale.
 */
function classifyPublishError(
  e: unknown,
): Result<
  never,
  | TransportError
  | AuthRequiredError
  | AgentNotReachableError
  | PublishNeedsConnectionError
  | PublishFailedError
> {
  const msg = e instanceof Error ? e.message : String(e);

  // app_not_connected / access_restricted: server encodes a fix-it URL.
  const cta = msg.match(/platform-cta:(\S+)/)?.[1];
  if (cta !== undefined) {
    return err({
      kind: "publish-needs-connection",
      message: msg.replace(/\nplatform-cta:\S+/, "").trim(),
      cta,
    });
  }

  const code = (e as { data?: { code?: string } })?.data?.code;
  // Error-state agent (PRECONDITION_FAILED, no CTA) or wake-to-ready timeout
  // (INTERNAL_SERVER_ERROR from ensureAgentReachable, identifiable message).
  if (
    code === "PRECONDITION_FAILED" ||
    (code === "INTERNAL_SERVER_ERROR" && /could not be made ready/.test(msg))
  ) {
    return err({ kind: "agent-not-reachable", reason: msg });
  }

  // Any other tRPC error from a reachable server — missing skill (NOT_FOUND),
  // GitHub 403/404/5xx, bad request. Print the server message verbatim, not
  // through printServiceError (whose "cannot reach server" wording is wrong
  // for a relayed application error).
  if (code !== undefined) {
    return err({ kind: "publish-failed", message: msg });
  }

  // No tRPC code ⇒ genuine transport / auth-required.
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
    async addSource(input) {
      try {
        const created = (await deps.trpc.skills.sources.create.mutate(
          input,
        )) as SkillSource;
        return ok(created);
      } catch (e) {
        if ((e as { data?: { code?: string } })?.data?.code === "CONFLICT") {
          return err({ kind: "source-exists" });
        }
        return classifyTrpcError(e);
      }
    },
    async removeSource(id) {
      return trpcCall(async () => {
        await deps.trpc.skills.sources.delete.mutate({ id });
      });
    },
    async refreshSource(id) {
      try {
        await deps.trpc.skills.sources.refresh.mutate({ id });
        return ok(undefined);
      } catch (e) {
        if ((e as { data?: { code?: string } })?.data?.code === "NOT_FOUND") {
          return err({ kind: "source-not-found" });
        }
        return classifyTrpcError(e);
      }
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
    async state(agentId) {
      return trpcCall(
        async () =>
          (await deps.trpc.skills.state.query({ agentId })) as SkillsState,
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
    async publish(input) {
      try {
        const result = (await deps.trpc.skills.publish.mutate(
          input,
        )) as SkillPublishResult;
        return ok(result);
      } catch (e) {
        return classifyPublishError(e);
      }
    },
  };
}
