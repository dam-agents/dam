import { skipToken, useQuery } from "@tanstack/react-query";
import { EXPERIMENT_SKILL_NAME } from "api-server-api";

import { trpc } from "../../../trpc.js";
import { useAgentRunState } from "../../agents/api/queries.js";
import {
  type AgentGreetingOptions,
  useAgentGreeting,
} from "../../agents/hooks/use-agent-greeting.js";

const ONBOARD_COMMAND = "/experiment-onboard";

const SETUP_POLL_MS = 3000;
const SETUP_POLL_MAX_ATTEMPTS = 40;

interface SkillsStateShape {
  standalone: { name: string }[];
  installed: { name: string }[];
}

function useExperimentSetupReady(agentId: string | null, enabled: boolean) {
  const { data } = useQuery({
    ...trpc.skills.state.queryOptions(
      agentId && enabled ? { agentId } : skipToken,
    ),
    retry: false,
    refetchInterval: (query) =>
      hasSkill(query.state.data) ||
      query.state.dataUpdateCount >= SETUP_POLL_MAX_ATTEMPTS
        ? false
        : SETUP_POLL_MS,
    refetchOnWindowFocus: false,
  });
  return hasSkill(data);
}

function hasSkill(state: SkillsStateShape | undefined) {
  if (!state) return false;
  return [...state.standalone, ...state.installed].some(
    (skill) => skill.name === EXPERIMENT_SKILL_NAME,
  );
}

export function useExperimentGreeting(
  opts: Omit<AgentGreetingOptions, "command" | "setupReady">,
) {
  const runState = useAgentRunState(opts.agentId);
  const probing =
    opts.active && opts.idle && opts.agentId !== null && runState === "running";
  const setupReady = useExperimentSetupReady(opts.agentId, probing);
  useAgentGreeting({ ...opts, command: ONBOARD_COMMAND, setupReady });
}
