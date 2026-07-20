import type { ChannelConfig, ChannelType } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import { classifyTrpcError, trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type {
  AuthRequiredError,
  ChannelConflictError,
  ChannelInvalidInputError,
  ChannelPreconditionError,
  TransportError,
} from "../domain/errors.js";

type ChannelResult<T> = Result<T, TransportError | AuthRequiredError>;
type ChannelList = readonly ChannelConfig[];

export interface ChannelService {
  /** Host-wide messenger capability flags the operator enabled via Helm. */
  available(): Promise<ChannelResult<Partial<Record<ChannelType, boolean>>>>;
  /** Bind a Slack channel; returns the Agent's resulting channel set. */
  connectSlack(
    id: string,
    slackChannelId: string,
    mode?: "shared" | "person-scoped",
  ): Promise<
    Result<
      ChannelList,
      | TransportError
      | AuthRequiredError
      | ChannelConflictError
      | ChannelPreconditionError
      | ChannelInvalidInputError
    >
  >;
  /** Unbind the Agent's Slack channel. Idempotent server-side. */
  disconnectSlack(id: string): Promise<ChannelResult<ChannelList>>;
}

export function createChannelService(deps: {
  trpc: TrpcClient;
}): ChannelService {
  return {
    async available() {
      return trpcCall(() => deps.trpc.channels.available.query());
    },
    async connectSlack(id, slackChannelId, mode) {
      try {
        const agent = await deps.trpc.agents.connectSlack.mutate({
          id,
          slackChannelId,
          ...(mode ? { mode } : {}),
        });
        return ok(agent.channels);
      } catch (e) {
        const code = (e as { data?: { code?: string } })?.data?.code;
        const message = e instanceof Error ? e.message : String(e);
        if (code === "CONFLICT")
          return err({ kind: "channel-conflict", message });
        if (code === "PRECONDITION_FAILED")
          return err({ kind: "channel-precondition", message });
        if (code === "BAD_REQUEST")
          return err({ kind: "invalid-input", message });
        return classifyTrpcError(e);
      }
    },
    async disconnectSlack(id) {
      return trpcCall(async () => {
        const agent = await deps.trpc.agents.disconnectSlack.mutate({ id });
        return agent.channels;
      });
    },
  };
}
