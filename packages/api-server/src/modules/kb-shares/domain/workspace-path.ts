/**
 * UNIT_BOUNDARY_DESCRIPTION: derives where the agent's work directory sits
 * relative to the agent-runtime files API, which is rooted at the agent home.
 * A knowledge base's shareable folders live in the work directory (e.g. wiki/
 * under $HOME/work), so the workspace-roots listing that powers the share
 * dialog lists beneath this prefix rather than at the home root. The prefix
 * comes from configuration (agent home + work dir), never a hardcoded segment.
 */
export function workspacePrefixFrom(
  agentHome: string,
  agentWorkDir: string,
): string {
  const home = agentHome.replace(/\/+$/, "");
  const work = agentWorkDir.replace(/\/+$/, "");
  if (work === home) return "";
  if (work.startsWith(`${home}/`)) return work.slice(home.length + 1);
  return work;
}
