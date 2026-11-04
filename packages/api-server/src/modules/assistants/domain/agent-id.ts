import { createHash } from "node:crypto";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Agent a person's nth assistant incarnation is.
 * Deriving it from the owner and the incarnation rather than inventing it makes
 * every replica compute the same id, so the store's own uniqueness is the things
 * that guarantees one Agent: a second create is refused, and the caller adopts
 * what is there. A new incarnation is a new id, so nothing that still refers to
 * the old one — the artifacts sweeper above all — can reach the new Agent.
 */
export function assistantAgentId(owner: string, incarnation: number): string {
  const digest = createHash("sha256")
    .update(`assistant\n${owner}\n${incarnation}`)
    .digest("hex");
  return `agent-${digest.slice(0, 16)}`;
}
