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
  listSources(
    agentId?: string,
  ): Promise<
    Result<readonly SkillSource[], TransportError | AuthRequiredError>
  >;

  addSource(input: {
    name: string;
    gitUrl: string;
    path?: string;
  }): Promise<
    Result<
      SkillSource,
      TransportError | AuthRequiredError | SourceAlreadyExistsError
    >
  >;

  removeSource(
    id: string,
  ): Promise<Result<void, TransportError | AuthRequiredError>>;

  refreshSource(
    id: string,
  ): Promise<
    Result<void, TransportError | AuthRequiredError | SourceNotFoundError>
  >;

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

  installed(
    agentId: string,
  ): Promise<Result<readonly SkillRef[], TransportError | AuthRequiredError>>;

  state(
    agentId: string,
  ): Promise<Result<SkillsState, TransportError | AuthRequiredError>>;

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

  const cta = msg.match(/platform-cta:(\S+)/)?.[1];
  if (cta !== undefined) {
    return err({
      kind: "publish-needs-connection",
      message: msg.replace(/\nplatform-cta:\S+/, "").trim(),
      cta,
    });
  }

  const code = (e as { data?: { code?: string } })?.data?.code;
  if (
    code === "PRECONDITION_FAILED" ||
    (code === "INTERNAL_SERVER_ERROR" && /could not be made ready/.test(msg))
  ) {
    return err({ kind: "agent-not-reachable", reason: msg });
  }

  if (code !== undefined) {
    return err({ kind: "publish-failed", message: msg });
  }

  return classifyTrpcError(e);
}

export function createSkillsService(deps: { trpc: TrpcClient }): SkillsService {
  return {
    async listSources(agentId) {
      return trpcCall(() =>
        deps.trpc.skills.sources.list.query(agentId ? { agentId } : undefined),
      );
    },
    async addSource(input) {
      try {
        const created = await deps.trpc.skills.sources.create.mutate(input);
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
        const skills = await deps.trpc.skills.list.query({
          sourceId,
          agentId,
        });
        return ok(skills);
      } catch (e) {
        if (agentId === undefined) {
          const code = (e as { data?: { code?: string } })?.data?.code;
          if (code === "PRECONDITION_FAILED")
            return err({ kind: "private-source-needs-agent" });
          return classifyTrpcError(e);
        }
        const cta = (e instanceof Error ? e.message : "").match(
          /platform-cta:(\S+)/,
        )?.[1];
        if (cta !== undefined) {
          const message = (e as Error).message
            .replace(/\nplatform-cta:\S+/, "")
            .trim();
          return err({ kind: "source-needs-connection", message, cta });
        }
        if ((e as { data?: { code?: string } })?.data?.code === "FORBIDDEN") {
          return err({
            kind: "source-needs-connection",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return classifyWakeError(e);
      }
    },
    async installed(agentId) {
      return trpcCall(
        async () => (await deps.trpc.skills.state.query({ agentId })).installed,
      );
    },
    async state(agentId) {
      return trpcCall(() => deps.trpc.skills.state.query({ agentId }));
    },
    async install(input) {
      try {
        const refs = await deps.trpc.skills.install.mutate(input);
        return ok(refs);
      } catch (e) {
        return classifyWakeError(e);
      }
    },
    async uninstall(input) {
      try {
        const refs = await deps.trpc.skills.uninstall.mutate(input);
        return ok(refs);
      } catch (e) {
        return classifyWakeError(e);
      }
    },
    async publish(input) {
      try {
        const result = await deps.trpc.skills.publish.mutate(input);
        return ok(result);
      } catch (e) {
        return classifyPublishError(e);
      }
    },
  };
}
