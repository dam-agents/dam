import type { AgentStore } from "../../modules/agents/infrastructure/agent-store.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads an Agent's harness image from its record so
 * a submission can be stamped with the image that produced it. The record is
 * the only place the image lives and it disappears with the Agent, so the value
 * is snapshotted at submit time rather than joined at read time — an Edition of
 * a deleted Agent still says which build wrote it. It lives here, as a port the
 * harness app injects, to keep the case-studies module off the agent store.
 */
export function createAgentImageReader(store: AgentStore) {
  return async (agentId: string): Promise<string | null> => {
    try {
      const image = (await store.get(agentId))?.spec.image;
      return typeof image === "string" && image.length > 0 ? image : null;
    } catch {
      return null;
    }
  };
}
