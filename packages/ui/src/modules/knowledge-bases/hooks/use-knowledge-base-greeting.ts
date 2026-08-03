import {
  type AgentGreetingOptions,
  useAgentGreeting,
} from "../../agents/hooks/use-agent-greeting.js";

/** The onboarding command every KB template's bootstrap installs; running it
 *  makes the agent greet the user and propose next steps. */
const ONBOARD_COMMAND = "/wiki-onboard";

/** Greet the user on a freshly-created knowledge base.
 *
 *  No setup gate: `/wiki-onboard` is a *command* and `skills.state` reports only
 *  skills, so a fast open can still greet before the bootstrap lands (#2946). */
export function useKnowledgeBaseGreeting(
  opts: Omit<AgentGreetingOptions, "command" | "setupReady">,
) {
  useAgentGreeting({ ...opts, command: ONBOARD_COMMAND });
}
