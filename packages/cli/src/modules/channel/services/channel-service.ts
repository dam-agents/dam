import type { ChannelType } from "api-server-api";
import type { Result } from "../../../result.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { AuthRequiredError, TransportError } from "../domain/errors.js";

type ChannelResult<T> = Result<T, TransportError | AuthRequiredError>;

export interface ChannelService {
  /** Host-wide messenger capability flags the operator enabled via Helm. */
  available(): Promise<ChannelResult<Partial<Record<ChannelType, boolean>>>>;
}

export function createChannelService(deps: {
  trpc: TrpcClient;
}): ChannelService {
  return {
    async available() {
      return trpcCall(() => deps.trpc.channels.available.query());
    },
  };
}
