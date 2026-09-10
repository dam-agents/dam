import {
  type AgentGreetingOptions,
  useAgentGreeting,
} from "../../agents/hooks/use-agent-greeting.js";
import { useStarterKitOnboarding } from "../api/queries.js";

export function useStarterKitGreeting(
  opts: Omit<AgentGreetingOptions, "command" | "setupReady">,
) {
  const { data: prompt } = useStarterKitOnboarding(opts.agentId, opts.active);
  useAgentGreeting({
    ...opts,
    active: opts.active && typeof prompt === "string",
    setupReady: typeof prompt === "string",
    command: prompt ?? "",
  });
}
