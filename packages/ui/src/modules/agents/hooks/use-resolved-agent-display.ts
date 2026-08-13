import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  type AgentDisplay,
  resolveAgentDisplay,
} from "../utils/agent-resolver.js";
import { useSyncRestartingAgents } from "./use-restart-agent.js";
import { useSyncPausingAgents } from "./use-suspend-agent.js";

const NO_IDS: ReadonlySet<string> = new Set();

export function useResolvedAgentDisplay(
  agent: AgentView | null | undefined,
): AgentDisplay | null {
  useSyncRestartingAgents();
  useSyncPausingAgents();
  const restarting = useStore((s) =>
    agent ? s.restartingAgents.has(agent.id) : false,
  );
  const pausing = useStore((s) =>
    agent ? s.pausingAgents.has(agent.id) : false,
  );
  if (!agent) return null;
  return resolveAgentDisplay(
    agent,
    restarting ? new Set([agent.id]) : NO_IDS,
    pausing ? new Set([agent.id]) : NO_IDS,
  );
}
