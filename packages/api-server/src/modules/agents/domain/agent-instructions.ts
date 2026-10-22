import type { AgentCreateInput } from "api-server-api";

export const AGENT_INSTRUCTIONS_TEMPLATE = `# AGENTS.md

Instructions for this agent.
Every harness reads this file when a session starts, so it keeps working when you switch harness.
Write here what the agent is for, how it should work, and what it must not do.
`;

export function seedsAgentInstructions(input: AgentCreateInput): boolean {
  return (
    !input.starterKit &&
    !input.kind &&
    !input.sweepable &&
    !input.environmentOf &&
    input.gitRepo?.into !== "home"
  );
}
