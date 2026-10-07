import type { ChannelConfig, ChannelType } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import {
  classifyTrpcError,
  trpcCall,
  trpcErrorCode,
} from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type {
  AuthRequiredError,
  ChannelConflictError,
  ChannelInvalidInputError,
  ChannelPreconditionError,
  TransportError,
} from "../domain/errors.js";
import { errorMessage } from "../../shared/error-message.js";

type ChannelResult<T> = Result<T, TransportError | AuthRequiredError>;
type ChannelList = readonly ChannelConfig[];

export interface ChannelService {
  available(): Promise<ChannelResult<Partial<Record<ChannelType, boolean>>>>;
  connectSlack(
    id: string,
    slackChannelId: string,
    ambient?: boolean,
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
  disconnectSlack(
    id: string,
    slackChannelId?: string,
  ): Promise<ChannelResult<ChannelList>>;
}

export function createChannelService(deps: {
  trpc: TrpcClient;
}): ChannelService {
  return {
    async available() {
      return trpcCall(() => deps.trpc.channels.available.query());
    },
    async connectSlack(id, slackChannelId, ambient) {
      try {
        const agent = await deps.trpc.agents.connectSlack.mutate({
          id,
          slackChannelId,
          ...(ambient ? { ambient: true } : {}),
        });
        return ok(agent.channels);
      } catch (e) {
        const code = trpcErrorCode(e);
        const message = errorMessage(e);
        if (code === "CONFLICT")
          return err({ kind: "channel-conflict", message });
        if (code === "PRECONDITION_FAILED")
          return err({ kind: "channel-precondition", message });
        if (code === "BAD_REQUEST")
          return err({ kind: "invalid-input", message });
        return classifyTrpcError(e);
      }
    },
    async disconnectSlack(id, slackChannelId) {
      return trpcCall(async () => {
        const agent = await deps.trpc.agents.disconnectSlack.mutate({
          id,
          ...(slackChannelId ? { slackChannelId } : {}),
        });
        return agent.channels;
      });
    },
  };
}
