import {
  and,
  eq,
  inArray,
  channels as channelsTable,
  schedules as schedulesTable,
  telegramConversations as telegramConversationsTable,
  type Db,
} from "db";
import { ChannelType } from "api-server-api";

export interface UnattendedWork {
  readonly schedules: boolean;
  readonly slack: boolean;
  readonly telegram: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what each of the given Agents runs while nobody
 * watches: an enabled Schedule, a Slack Channel bound in `channels`, or a
 * Telegram chat bound in `telegram_conversations`. A Slack Channel and a
 * Telegram chat are stored apart, each where its own binding flow writes it,
 * so both stores are asked. Each read asks only whether one such row exists.
 * Only Agents with such work are in the result. The default-model notices and
 * the outage alerts both read it, so they agree on which Agents run
 * unattended.
 */
export async function readUnattendedWork(
  db: Db,
  agentIds: readonly string[],
): Promise<Map<string, UnattendedWork>> {
  if (agentIds.length === 0) return new Map();
  const ids = [...agentIds];
  const [scheduleRows, slackRows, telegramRows] = await Promise.all([
    db
      .selectDistinct({ agentId: schedulesTable.agentId })
      .from(schedulesTable)
      .where(
        and(
          inArray(schedulesTable.agentId, ids),
          eq(schedulesTable.enabled, true),
        ),
      ),
    db
      .selectDistinct({ agentId: channelsTable.agentId })
      .from(channelsTable)
      .where(
        and(
          inArray(channelsTable.agentId, ids),
          eq(channelsTable.type, ChannelType.Slack),
        ),
      ),
    db
      .selectDistinct({ agentId: telegramConversationsTable.agentId })
      .from(telegramConversationsTable)
      .where(inArray(telegramConversationsTable.agentId, ids)),
  ]);
  const agentsOf = (rows: readonly { agentId: string }[]) =>
    new Set(rows.map((r) => r.agentId));
  const schedules = agentsOf(scheduleRows);
  const slack = agentsOf(slackRows);
  const telegram = agentsOf(telegramRows);
  return new Map(
    [...new Set([...schedules, ...slack, ...telegram])].map((agentId) => [
      agentId,
      {
        schedules: schedules.has(agentId),
        slack: slack.has(agentId),
        telegram: telegram.has(agentId),
      },
    ]),
  );
}
