/** Expand `$HOME` / `${HOME}` in a driver target path to the agent's home. */
export function expandHome(path: string, agentHome: string): string {
  return path.replace(/\$HOME\b/g, agentHome).replace(/\$\{HOME\}/g, agentHome);
}
