import type { Db } from "db";
import { slackUntaggedReplyNotes, sql } from "db";
import type { SubPseudonymizer } from "../../../core/sub-pseudonymizer.js";
import {
  UNTAGGED_NOTE_GAP_MS,
  UNTAGGED_NOTE_NEW_USER_MS,
  untaggedNoteDue,
  type UntaggedNoteLearner,
} from "../domain/untagged-reply-note.js";

export interface SlackUntaggedReplyNotes {
  used(slackUserId: string, opts: { tagged: boolean }): Promise<void>;
  due(slackUserId: string): Promise<boolean>;
  claim(slackUserId: string): Promise<boolean>;
}

/** UNIT_BOUNDARY_DESCRIPTION: Keeps, per person, what the untagged-reply note
 *  needs to know across restarts and replicas. `used` records a person's first
 *  use of the platform in Slack, and a tag after an earlier note graduates
 *  them. `due` reads whether they may get the note now. `claim` records the
 *  note as shown only when it is still due, in one statement, so two replicas
 *  that both decided to post it cannot both win. */
export function createSlackUntaggedReplyNotesRepository(
  db: Db,
  pseudo: SubPseudonymizer,
): SlackUntaggedReplyNotes {
  const dueNow = sql`${slackUntaggedReplyNotes.graduatedAt} IS NULL
    AND ${slackUntaggedReplyNotes.firstUsedAt} > now() - make_interval(secs => ${UNTAGGED_NOTE_NEW_USER_MS / 1000})
    AND (${slackUntaggedReplyNotes.lastNotedAt} IS NULL
      OR ${slackUntaggedReplyNotes.lastNotedAt} <= now() - make_interval(secs => ${UNTAGGED_NOTE_GAP_MS / 1000}))`;

  async function firstUse(actorHash: string): Promise<void> {
    await db
      .insert(slackUntaggedReplyNotes)
      .values({ actorHash })
      .onConflictDoNothing();
  }

  return {
    async used(slackUserId, opts) {
      const actorHash = pseudo.hashSub(slackUserId);
      if (!opts.tagged) return firstUse(actorHash);
      await db
        .insert(slackUntaggedReplyNotes)
        .values({ actorHash })
        .onConflictDoUpdate({
          target: slackUntaggedReplyNotes.actorHash,
          set: { graduatedAt: sql`now()` },
          setWhere: sql`${slackUntaggedReplyNotes.lastNotedAt} IS NOT NULL AND ${slackUntaggedReplyNotes.graduatedAt} IS NULL`,
        });
    },
    async due(slackUserId) {
      const actorHash = pseudo.hashSub(slackUserId);
      await firstUse(actorHash);
      const rows = await db
        .select({ actorHash: slackUntaggedReplyNotes.actorHash })
        .from(slackUntaggedReplyNotes)
        .where(
          sql`${slackUntaggedReplyNotes.actorHash} = ${actorHash} AND ${dueNow}`,
        );
      return rows.length > 0;
    },
    async claim(slackUserId) {
      const actorHash = pseudo.hashSub(slackUserId);
      const claimed = await db
        .update(slackUntaggedReplyNotes)
        .set({ lastNotedAt: sql`now()` })
        .where(
          sql`${slackUntaggedReplyNotes.actorHash} = ${actorHash} AND ${dueNow}`,
        )
        .returning({ actorHash: slackUntaggedReplyNotes.actorHash });
      return claimed.length > 0;
    },
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: The same record in the worker's memory, for
 *  tests and for a worker run without a database. The clock is injectable so
 *  a test can step past the note's three-week and one-week limits. */
export function createMemorySlackUntaggedReplyNotes(
  opts: {
    now?: () => Date;
    learners?: Map<string, UntaggedNoteLearner>;
  } = {},
): SlackUntaggedReplyNotes {
  const now = opts.now ?? (() => new Date());
  const learners = opts.learners ?? new Map<string, UntaggedNoteLearner>();
  const learnerOf = (slackUserId: string): UntaggedNoteLearner => {
    const known = learners.get(slackUserId);
    if (known) return known;
    const fresh = { firstUsedAt: now(), lastNotedAt: null, graduatedAt: null };
    learners.set(slackUserId, fresh);
    return fresh;
  };
  return {
    async used(slackUserId, { tagged }) {
      const learner = learnerOf(slackUserId);
      if (tagged && learner.lastNotedAt !== null && !learner.graduatedAt)
        learner.graduatedAt = now();
    },
    async due(slackUserId) {
      return untaggedNoteDue(learnerOf(slackUserId), now());
    },
    async claim(slackUserId) {
      const learner = learnerOf(slackUserId);
      if (!untaggedNoteDue(learner, now())) return false;
      learner.lastNotedAt = now();
      return true;
    },
  };
}
