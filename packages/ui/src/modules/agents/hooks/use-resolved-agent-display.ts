import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  type AgentDisplay,
  resolveAgentDisplay,
} from "../utils/agent-resolver.js";
import { useSlowStartIds } from "./use-slow-start.js";

const NO_IDS: ReadonlySet<string> = new Set();

export function useResolvedAgentDisplay(
  agent: AgentView | null | undefined,
): AgentDisplay | null {
  const slowStartIds = useSlowStartIds();
  const restarting = useStore((s) =>
    agent ? s.restartingAgents.has(agent.id) : false,
  );
  if (!agent) return null;
  return resolveAgentDisplay(
    agent,
    restarting ? new Set([agent.id]) : NO_IDS,
    slowStartIds,
  );
}
