import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import type { AgentsRepository } from "../infrastructure/agents-repository.js";

type LegacyDisabledAgents = Pick<
  AgentsRepository,
  "list" | "clearLegacyDisabled"
>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the disabled mark outlived the feature that wrote
 * it, so an Agent still carrying one read as asleep but woke on nothing.
 * At boot each Agent still marked is cleared through the same write that clears
 * its standing stop request, which leaves it an ordinary idle Agent that wakes
 * on its next use; a failure leaves the mark for the next boot rather than
 * stopping the api-server.
 * The mark is read off the Agent, so the one walk covers both stores.
 */
export async function clearLegacyDisabledMarks(
  agents: LegacyDisabledAgents,
): Promise<number> {
  const marked = (await agents.list()).filter((agent) => agent.disabled);
  let cleared = 0;
  for (const agent of marked) {
    try {
      if (await agents.clearLegacyDisabled(agent.id)) cleared += 1;
    } catch (err) {
      getLogger().warn(
        { agentId: agent.id, reason: formatError(err) },
        "agent.legacy_disabled.clear_failed",
      );
    }
  }
  if (cleared > 0)
    getLogger().info(
      { cleared },
      "agent.legacy_disabled.cleared — these Agents read as idle and wake on next use",
    );
  return cleared;
}
