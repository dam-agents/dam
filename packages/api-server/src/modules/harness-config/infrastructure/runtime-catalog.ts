import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter, HarnessCatalogView } from "agent-runtime-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

const CATALOG_TIMEOUT_MS = 10_000;

export function createRuntimeCatalogReader(
  namespace: string,
): (agentId: string, harness: string) => Promise<HarnessCatalogView | null> {
  return async (agentId, harness) => {
    const client = createTRPCClient<AppRouter>({
      links: [
        httpLink({ url: `http://${podBaseUrl(agentId, namespace)}/api/trpc` }),
      ],
    });
    return (await client.harnessConfig.catalog.query(
      { harness },
      { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) },
    )) as HarnessCatalogView;
  };
}
