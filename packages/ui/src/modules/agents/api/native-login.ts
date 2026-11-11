import { skipToken, useQuery } from "@tanstack/react-query";

import { agentTrpc, agentTrpcHttp } from "../agent-trpc.js";
import { useAgentLacksLiveUpdates, useIsAgentOperable } from "./queries.js";

export function useNativeLoginStatus(agentId: string, signingIn: boolean) {
  const operable = useIsAgentOperable(agentId);
  const compat = useAgentLacksLiveUpdates(agentId);
  const query = useQuery({
    queryKey: ["native-login", agentId],
    queryFn: operable
      ? () =>
          (compat
            ? agentTrpcHttp(agentId)
            : agentTrpc(agentId)
          ).nativeLogin.status.query()
      : skipToken,
    retry: false,
    staleTime: 10_000,
    refetchInterval: signingIn ? 2_000 : 30_000,
  });
  return { ...query, operable };
}
