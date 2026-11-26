// UNIT_BOUNDARY_DESCRIPTION: what an Agent that calls the platform with its own Agent Key may reach. Every procedure is closed to it unless this list names it, so a procedure added later starts closed. The first step lets the Agent read itself and nothing else: both procedures narrow to the one Agent its key names.
export const AGENT_CALLER_PROCEDURES: ReadonlySet<string> = new Set([
  "agents.list",
  "agents.get",
]);

export const AGENT_CALLER_REFUSAL =
  "An agent that calls the platform as itself can only read itself for now. Its owner does this in the app or with their own sign-in.";
