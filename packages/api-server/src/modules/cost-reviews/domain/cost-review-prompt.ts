export const COST_REVIEW_SKILL = "agent-cost-review";
export const COST_REVIEW_SESSION_TITLE = "Cost review";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the first turn of the Session the platform opens
 * when the owner accepts the offer of a cost review. It names the skill that
 * holds the procedure, so the procedure lives in one place. The owner asked
 * for a review, not for changes, so the agent offers changes and makes none
 * before the owner says yes. The agent cannot see the owner's experimental
 * features, so the turn says whether the report can carry buttons.
 */
export function composeCostReviewPrompt(interactive: boolean): string {
  return [
    "Your owner accepted the platform's offer of a cost review for you, and will read your reply in this chat.",
    "",
    `Use your ${COST_REVIEW_SKILL} skill to find out where your spend went over the last 7 days and what would cut it most. Answer here in the chat.`,
    "Recommend changes and offer to make the ones you can. Do not change your schedules, instructions, skills or settings until the owner says yes.",
    interactive
      ? "Interactive artifacts are on for your owner, so the report can be interactive."
      : "Interactive artifacts are off for your owner, so make the report without buttons.",
    `If you do not have the ${COST_REVIEW_SKILL} skill, say so, then review your spend with the get_metrics tool as well as you can.`,
  ].join("\n");
}
