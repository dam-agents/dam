import type { SlackLoopGuardDrop, SlackLoopGuardDrops } from "api-server-api";
import type { Db } from "db";
import { and, gte, inArray, slackLoopGuardDrops, sql } from "db";

export const LOOP_GUARD_DROPS_SHOWN_MS = 24 * 60 * 60 * 1000;

const RECENT_KEPT = 5;

export interface SlackLoopGuardDropsRepository {
  record(channelId: string, drop: SlackLoopGuardDrop): Promise<void>;
  readMany(
    channelIds: string[],
    now?: Date,
  ): Promise<Map<string, SlackLoopGuardDrops>>;
}

/** UNIT_BOUNDARY_DESCRIPTION: Keeps, per Slack conversation, how many bot and
 *  app posts the loop guard dropped and the newest few of them. A drop more
 *  than a day after the one before starts the count again, and a conversation
 *  whose last drop is more than a day old reads as having none. */
export function createSlackLoopGuardDropsRepository(
  db: Db,
): SlackLoopGuardDropsRepository {
  return {
    async record(channelId, drop) {
      const at = new Date(drop.at);
      const since = new Date(at.getTime() - LOOP_GUARD_DROPS_SHOWN_MS);
      const fresh = sql`${slackLoopGuardDrops.lastDroppedAt} > ${since.toISOString()}::timestamptz`;
      await db
        .insert(slackLoopGuardDrops)
        .values({ channelId, dropped: 1, lastDroppedAt: at, recent: [drop] })
        .onConflictDoUpdate({
          target: slackLoopGuardDrops.channelId,
          set: {
            dropped: sql`CASE WHEN ${fresh} THEN ${slackLoopGuardDrops.dropped} + 1 ELSE 1 END`,
            lastDroppedAt: at,
            recent: sql`CASE WHEN ${fresh} THEN jsonb_path_query_array(excluded.recent || ${slackLoopGuardDrops.recent}, ${sql.raw(`'$[0 to ${RECENT_KEPT - 1}]'`)}) ELSE excluded.recent END`,
          },
        });
    },
    async readMany(channelIds, now = new Date()) {
      const drops = new Map<string, SlackLoopGuardDrops>();
      if (channelIds.length === 0) return drops;
      const rows = await db
        .select()
        .from(slackLoopGuardDrops)
        .where(
          and(
            inArray(slackLoopGuardDrops.channelId, channelIds),
            gte(
              slackLoopGuardDrops.lastDroppedAt,
              new Date(now.getTime() - LOOP_GUARD_DROPS_SHOWN_MS),
            ),
          ),
        );
      for (const row of rows) {
        drops.set(row.channelId, {
          dropped: row.dropped,
          lastDroppedAt: row.lastDroppedAt.toISOString(),
          recent: row.recent,
        });
      }
      return drops;
    },
  };
}
