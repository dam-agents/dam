import { AGENT_ID_RE } from "api-server-api";

const BARE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

// UNIT_BOUNDARY_DESCRIPTION: how a copied CLI command names an agent. The CLI takes a name when exactly one agent carries it, so a unique name is used, bare when it is letters, digits, `_` and `-`, otherwise in single quotes, which bash, zsh and fish read the same way, a quote inside written as '\''. An ambiguous name, one that looks like an agent id, or one starting with `-`, which would read as a flag, falls back to the id.
export function cliAgentRef(
  agent: { id: string; name: string },
  agents: readonly { name: string }[],
): string {
  const { id, name } = agent;
  if (
    !name ||
    name.startsWith("-") ||
    AGENT_ID_RE.test(name) ||
    agents.filter((a) => a.name === name).length !== 1
  )
    return id;
  return BARE.test(name) ? name : `'${name.split("'").join("'\\''")}'`;
}
