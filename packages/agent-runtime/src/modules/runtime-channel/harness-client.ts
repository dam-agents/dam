import { createTRPCClient, httpLink } from "@trpc/client";
import type { HarnessRouter } from "api-server-api";

/**
 * tRPC client for the harness API server (ADR-022, ADR-052). Used by the
 * agent runtime to:
 *   - call `runtime.v1.hello` on boot / wake / reconnect
 *   - call `runtime.v1.events.<kind>` once per event the apply payload carries
 *
 * The agent's outbound HTTP path runs through the paired gateway pod's
 * Envoy, which conveys the gateway-pod's SPIFFE principal to the api-server
 * waypoint. The waypoint enforces principal == agent identity. No
 * Authorization header is set here — identity is L4-pinned.
 */

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
