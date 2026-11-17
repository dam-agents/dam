import {
  weeklyRuleFor,
  type AssistantScheduleDefinition,
} from "./assistant-schedule.js";

const KIND = "security-check";

function composeSecurityCheckTask(): string {
  return [
    "Run the weekly security check of your owner's setup on this install.",
    "This run only reads: change nothing until your owner agrees in this chat.",
    "",
    "1. Read the security advisory of your dam skill first (references/security-advisory.md). It alone says what a problem is: its rule, and its table of set-ups. Report nothing that it does not call bad or to avoid.",
    "2. Read the whole setup. List the agents with `dam agent list --json`. For each agent run `dam agent get <agent> --json`, `dam channel list <agent> --json`, `dam connection list <agent> --json` and `dam network list <agent>`. Run `dam satellite list --json` once. Do not open the agents' files or sessions: this check covers what those commands list.",
    "3. Leave out what your owner already accepted. Your memory file lists the problems they told you are fine. Such a set-up is not a problem again until it changes, for example when a channel gets a new member or an agent gets another connection.",
    "4. Describe each problem in this chat: what in the setup goes against the advisory, which part of the advisory it goes against, and the safer setup. Then offer to fix the ones you can, and say which ones only your owner can fix in the web app. Use plain words and no command output. When you found nothing, say so in one sentence.",
    '5. Report once, at the end of the check: `dam security-check report --problem "<short title>"`, with one --problem for each problem. A title names the agent and the problem in a few words, and your owner reads it in their alert, so put no secret and no command in it. When you found nothing, run `dam security-check report` with no --problem, which clears an earlier alert.',
    "6. Your owner's alert opens this chat. Fix only what they agree to here, and follow the advisory's safer setup. When they say a problem is fine as it is, write it to your memory file as accepted, with the agent and the set-up it is about. After a fix or an acceptance, run `dam security-check report` again with the problems that are left.",
  ].join("\n");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the weekly security check as a Schedule the
 * platform gives the assistant. The minute of the week comes from the owner,
 * so one person's check keeps its time while an install's checks do not all
 * wake their Agents at once. The task holds the whole procedure, since only
 * this run needs it: what to read, how to describe a problem, how to report
 * it, and that nothing changes before the owner agrees. What counts as a
 * problem stays in the skill's security advisory, which the task points to.
 */
export const securityCheckSchedule: AssistantScheduleDefinition = {
  kind: KIND,
  subject: "security check",
  name: "Security check",
  sessionTitle: "Security check",
  timezone: "UTC",
  rule: (owner) => weeklyRuleFor(owner, KIND),
  task: composeSecurityCheckTask,
};
