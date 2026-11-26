import type { SpendStoppedLimit } from "api-server-api";
import { useMemo } from "react";

import { useSpendStopped } from "../api/queries.js";
import {
  allAgentsOn,
  LEVEL_NAMES,
  stoppedByLimit,
  thisAgentOn,
} from "../lib/copy.js";
import { localResetTime, meterAmount } from "../lib/format.js";

const NO_STOPPED: ReadonlyMap<string, string> = new Map();

function limitName(limit: SpendStoppedLimit): string {
  const provider = limit.connectionName ?? "";
  switch (limit.kind) {
    case "connection":
      return thisAgentOn(provider);
    case "owner-connection":
      return allAgentsOn(provider);
    case "owner":
      return LEVEL_NAMES.total;
    case "agent":
      return LEVEL_NAMES.agent;
    case "ceiling":
      return LEVEL_NAMES.ceiling;
  }
}

/** UNIT_BOUNDARY_DESCRIPTION: the owner's agents that a limit stopped today, each with the words that name the limit, what is left and when calls start again. */
export function useStoppedAgents(): ReadonlyMap<string, string> {
  const { data } = useSpendStopped();
  return useMemo(() => {
    if (!data || data.agents.length === 0) return NO_STOPPED;
    const until = localResetTime(data.resetsAt);
    return new Map(
      data.agents.map(({ agentId, limit }) => [
        agentId,
        stoppedByLimit(
          limitName(limit),
          meterAmount(limit.leftMicros, limit.unit),
          until,
        ),
      ]),
    );
  }, [data]);
}
