import { createTRPCClient, httpLink } from "@trpc/client";
import type { HarnessRouter } from "api-server-api";

export type HarnessClient = ReturnType<typeof createHarnessClient>;

export function createHarnessClient(opts: {
  apiServerUrl: string;
  agentId: string;
}) {
  return createTRPCClient<HarnessRouter>({
    links: [
      httpLink({
        url: new URL(
          `/api/agents/${encodeURIComponent(opts.agentId)}/trpc`,
          opts.apiServerUrl,
        ).toString(),
      }),
    ],
  });
}
