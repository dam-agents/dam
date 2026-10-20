import type { SessionPair } from "api-server-api";

import { useStore } from "../../../store.js";
import {
  useHarnessCatalog,
  useProviderConnections,
  useRememberedPair,
} from "../api/session-pair.js";
import { fittingProviders, nextPair } from "../lib/session-pair-options.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the pair a new session on the agent would start
 * on, as its picker shows it: the one picked for it, else the agent's saved
 * default, on a harness the agent carries.
 */
export function useNextSessionPair(
  agentId: string | null,
  carried: readonly string[],
  defaultHarness: string | undefined,
): SessionPair | null {
  const { data: catalog } = useHarnessCatalog();
  const { data: remembered } = useRememberedPair(agentId);
  const chosen = useStore((s) =>
    agentId ? (s.nextSessionPair[agentId] ?? null) : null,
  );
  const providers = useProviderConnections(agentId);
  if (!agentId) return null;
  return nextPair(
    chosen,
    remembered ?? null,
    carried,
    fittingProviders(catalog?.harnesses ?? [], providers.granted),
    defaultHarness,
  );
}
