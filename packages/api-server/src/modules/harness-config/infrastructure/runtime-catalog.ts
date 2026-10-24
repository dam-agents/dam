import type { HarnessCatalogView } from "agent-runtime-api";
import { agentServiceClient } from "../../../core/agent-service-client.js";

const CATALOG_TIMEOUT_MS = 10_000;

export function createRuntimeCatalogReader(
  namespace: string,
): (agentId: string, harness: string) => Promise<HarnessCatalogView | null> {
  return async (agentId, harness) =>
    (await agentServiceClient(agentId, namespace, {
      timeoutMs: CATALOG_TIMEOUT_MS,
      batch: false,
    }).harnessConfig.catalog.query({ harness })) as HarnessCatalogView;
}
