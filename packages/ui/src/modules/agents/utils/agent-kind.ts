import type { AgentView } from "../../../types.js";

/** Whether this agent belongs to the Knowledge Bases surface. The single
 *  place the kind literal is compared — list surfaces filter on this so an
 *  agent appears on exactly one of them. */
export function isKnowledgeBase(agent: AgentView): boolean {
  return agent.kind === "knowledge-base";
}
