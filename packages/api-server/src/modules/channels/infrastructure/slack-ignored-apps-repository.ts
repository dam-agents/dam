import type { Db } from "db";
import { and, eq, slackIgnoredApps } from "db";

export interface SlackIgnoredApp {
  botId: string;
  name: string;
}

export interface SlackIgnoredApps {
  list(channelId: string): Promise<SlackIgnoredApp[]>;
  ignore(
    channelId: string,
    app: SlackIgnoredApp,
    ignoredBy: string,
  ): Promise<boolean>;
  unignore(channelId: string, botId: string): Promise<boolean>;
}

export function createSlackIgnoredAppsRepository(db: Db): SlackIgnoredApps {
  return {
    async list(channelId) {
      return db
        .select({ botId: slackIgnoredApps.botId, name: slackIgnoredApps.name })
        .from(slackIgnoredApps)
        .where(eq(slackIgnoredApps.channelId, channelId))
        .orderBy(slackIgnoredApps.createdAt);
    },
    async ignore(channelId, app, ignoredBy) {
      const inserted = await db
        .insert(slackIgnoredApps)
        .values({ channelId, botId: app.botId, name: app.name, ignoredBy })
        .onConflictDoNothing()
        .returning({ botId: slackIgnoredApps.botId });
      return inserted.length > 0;
    },
    async unignore(channelId, botId) {
      const removed = await db
        .delete(slackIgnoredApps)
        .where(
          and(
            eq(slackIgnoredApps.channelId, channelId),
            eq(slackIgnoredApps.botId, botId),
          ),
        )
        .returning({ botId: slackIgnoredApps.botId });
      return removed.length > 0;
    },
  };
}
