import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import type { HomeVolume } from "agent-runtime-api";
import type { ApplyStateInput, ApplyStateResult } from "api-server-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

const APPLY_STATE_TIMEOUT_MS = 60_000;
// UNIT_BOUNDARY_DESCRIPTION: what HOME holds is a read on the way to a decision the browser is waiting for, so it gives up well inside a dialog's patience; an Agent that does not answer in time is one whose home the caller has not measured.
const HOME_VOLUME_TIMEOUT_MS = 2_000;

type FetchLike = NonNullable<Parameters<typeof httpLink>[0]["fetch"]>;

export interface AgentRuntimeClient {
  applyState(input: ApplyStateInput): Promise<ApplyStateResult>;
  homeVolume(): Promise<HomeVolume | null>;
}

interface AgentRuntimeClientOpts {
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createAgentRuntimeClient(
  agentId: string,
  namespace: string,
  opts: AgentRuntimeClientOpts = {},
): AgentRuntimeClient {
  const timeoutMs = opts.timeoutMs ?? APPLY_STATE_TIMEOUT_MS;
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `http://${podBaseUrl(agentId, namespace)}/api/trpc`,
        fetch: opts.fetch,
      }),
    ],
  });
  return {
    async applyState(input: ApplyStateInput): Promise<ApplyStateResult> {
      const r = await client.runtime.v1.applyState.mutate(
        input as unknown as Parameters<
          typeof client.runtime.v1.applyState.mutate
        >[0],
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      return r as ApplyStateResult;
    },
    async homeVolume(): Promise<HomeVolume | null> {
      return client.files.volume.query(undefined, {
        signal: AbortSignal.timeout(HOME_VOLUME_TIMEOUT_MS),
      });
    },
  };
}
