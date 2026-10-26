export type AgentMenuEntry =
  "rename" | "configure" | "disable" | "restart" | "remove";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what an Agent's row menu offers: with the Unified
 * right toolbar experiment on, its name and avatar, its power and its removal,
 * because its configuration is one rail tile away; with the experiment off, the
 * way into its configuration page.
 */
export function agentMenuEntries(
  rightToolbar: boolean,
): readonly AgentMenuEntry[] {
  return rightToolbar
    ? ["rename", "disable", "restart", "remove"]
    : ["configure", "remove"];
}
