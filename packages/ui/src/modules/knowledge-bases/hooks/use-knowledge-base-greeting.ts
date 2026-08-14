import {
  type AgentGreetingOptions,
  useAgentGreeting,
} from "../../agents/hooks/use-agent-greeting.js";

const ONBOARD_COMMAND = "/wiki-onboard";

export function useKnowledgeBaseGreeting(
  opts: Omit<AgentGreetingOptions, "command" | "setupReady">,
) {
  useAgentGreeting({ ...opts, command: ONBOARD_COMMAND });
}
