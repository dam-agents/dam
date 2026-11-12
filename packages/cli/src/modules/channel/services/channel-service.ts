import type {
  ChannelConfig,
  ChannelType,
  SlackBindingModes,
  SlackDmConnectView,
  SlackDmDisconnectView,
  SlackDmStatusView,
} from "api-server-api";
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
    modes?: SlackBindingModes,
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
  slackDmStatus(): Promise<ChannelResult<SlackDmStatusView>>;
  slackDmConnect(
    agentId: string,
    purpose?: string,
  ): Promise<
    Result<
      SlackDmConnectView,
      | TransportError
      | AuthRequiredError
      | ChannelConflictError
      | ChannelPreconditionError
      | ChannelInvalidInputError
    >
  >;
  slackDmDisconnect(
    agentId: string,
  ): Promise<ChannelResult<SlackDmDisconnectView>>;
}

export function createChannelService(deps: {
  trpc: TrpcClient;
}): ChannelService {
  return {
    async available() {
      return trpcCall(() => deps.trpc.channels.available.query());
    },
    async connectSlack(id, slackChannelId, modes) {
      try {
        const agent = await deps.trpc.agents.connectSlack.mutate({
          id,
          slackChannelId,
          ...(modes?.ambient !== undefined ? { ambient: modes.ambient } : {}),
          ...(modes?.history !== undefined ? { history: modes.history } : {}),
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
    async slackDmStatus() {
      return trpcCall(() => deps.trpc.channels.slackDmStatus.query());
    },
    async slackDmConnect(agentId, purpose) {
      try {
        const result = await deps.trpc.channels.slackDmConnect.mutate({
          agentId,
          ...(purpose === undefined ? {} : { purpose }),
        });
        return ok(result);
      } catch (e) {
        const code = trpcErrorCode(e);
        const message = errorMessage(e);
        if (code === "CONFLICT")
          return err({ kind: "channel-conflict", message });
        if (code === "PRECONDITION_FAILED" || code === "NOT_FOUND")
          return err({ kind: "channel-precondition", message });
        if (code === "BAD_REQUEST")
          return err({ kind: "invalid-input", message });
        return classifyTrpcError(e);
      }
    },
    async slackDmDisconnect(agentId) {
      return trpcCall(() =>
        deps.trpc.channels.slackDmDisconnect.mutate({ agentId }),
      );
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
