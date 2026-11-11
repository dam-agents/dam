export const UNTAGGED_NOTE_NEW_USER_MS = 21 * 24 * 60 * 60 * 1000;

export const UNTAGGED_NOTE_GAP_MS = 7 * 24 * 60 * 60 * 1000;

export const UNTAGGED_NOTE_QUIET_MS = 60 * 1000;

export interface UntaggedNoteLearner {
  firstUsedAt: Date;
  lastNotedAt: Date | null;
  graduatedAt: Date | null;
}

/** UNIT_BOUNDARY_DESCRIPTION: Whether a person may get the note that their
 *  untagged reply did not reach the Agent. The note is a short lesson for new
 *  users: it goes only to a person who first used the platform in Slack less
 *  than three weeks ago, who has not had it in the last week, and who has not
 *  graduated — tagged the bot after an earlier note, or used the platform in
 *  Slack before the note had these rules. So a new user sees it at most three
 *  times. */
export function untaggedNoteDue(
  learner: UntaggedNoteLearner,
  now: Date,
): boolean {
  if (learner.graduatedAt !== null) return false;
  if (now.getTime() - learner.firstUsedAt.getTime() >= UNTAGGED_NOTE_NEW_USER_MS)
    return false;
  return (
    learner.lastNotedAt === null ||
    now.getTime() - learner.lastNotedAt.getTime() >= UNTAGGED_NOTE_GAP_MS
  );
}
