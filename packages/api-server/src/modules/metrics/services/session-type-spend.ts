import type { SessionCategory, SpendBySessionType } from "api-server-api";

import { spendBySessionType } from "../domain/spend-by-session-type.js";
import type { MetricsWindow, SessionSpend } from "./metrics-service.js";

export interface SessionTypeSpend {
  breakdown(
    agentIds: readonly string[],
    window: MetricsWindow,
  ): Promise<SpendBySessionType[]>;
}

export function createSessionTypeSpend(deps: {
  readSpend: (
    agentIds: readonly string[],
    window: MetricsWindow,
  ) => Promise<SessionSpend[]>;
  categorizeSessions: (
    agentIds: readonly string[],
    sessionIds: readonly string[],
  ) => Promise<ReadonlyMap<string, SessionCategory>>;
  isEnabled: () => Promise<boolean>;
}): SessionTypeSpend {
  return {
    async breakdown(agentIds, window) {
      if (!(await deps.isEnabled())) return [];
      const sessions = await deps.readSpend(agentIds, window);
      const categories = await deps.categorizeSessions(
        agentIds,
        sessions.map((s) => s.sessionId),
      );
      return spendBySessionType(sessions, categories);
    },
  };
}
