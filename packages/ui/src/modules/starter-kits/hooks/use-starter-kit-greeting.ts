import {
  type AgentGreetingOptions,
  useAgentGreeting,
} from "../../agents/hooks/use-agent-greeting.js";
import { useClaimStarterKitOnboarding } from "../api/mutations.js";

export function useStarterKitGreeting(
  opts: Omit<AgentGreetingOptions, "command" | "setupReady">,
) {
  const claim = useClaimStarterKitOnboarding();
  useAgentGreeting({
    ...opts,
    hidden: false,
    command: (agentId) => claim.mutateAsync(agentId),
  });
}
