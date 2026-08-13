import type { Db } from "db";
import { channels, eq, and, inArray, sql } from "db";
import { ChannelType, type ChannelConfig } from "api-server-api";
import type { Tx } from "../../../core/unit-of-work.js";
import { isUniqueViolation } from "../../../core/db-errors.js";

function toChannelConfig(row: {
  type: string;
  config: unknown;
}): ChannelConfig {
  const config = row.config as Record<string, unknown>;
  return { type: row.type as ChannelType, ...config } as ChannelConfig;
}

export function listChannelsByOwner(db: Db, owner: string) {
  return async (): Promise<Map<string, ChannelConfig[]>> => {
    const condition = owner ? eq(channels.owner, owner) : undefined;
    const rows = await db.select().from(channels).where(condition);
    const map = new Map<string, ChannelConfig[]>();
    for (const row of rows) {
      const list = map.get(row.agentId) ?? [];
      list.push(toChannelConfig(row));
      map.set(row.agentId, list);
    }
    return map;
  };
}

export function listChannelsByAgent(db: Db, owner: string) {
  return async (agentId: string): Promise<ChannelConfig[]> => {
    const rows = await db
      .select()
      .from(channels)
      .where(and(eq(channels.agentId, agentId), eq(channels.owner, owner)));
    return rows.map(toChannelConfig);
  };
}

async function upsertSlackChannel(
  runner: Db | Tx,
  owner: string,
  agentId: string,
  channel: ChannelConfig,
): Promise<void> {
  const { type, ...config } = channel;
  const updated = await runner
    .update(channels)
    .set({ owner, config })
    .where(
      and(
        eq(channels.agentId, agentId),
        eq(channels.type, type),
        sql`${channels.config}->>'slackChannelId' = ${channel.slackChannelId}`,
      ),
    )
    .returning({ agentId: channels.agentId });
  if (updated.length > 0) return;
  await runner.insert(channels).values({ agentId, owner, type, config });
}

export function upsertChannel(db: Db, owner: string) {
  return async (agentId: string, channel: ChannelConfig): Promise<void> => {
    await upsertSlackChannel(db, owner, agentId, channel);
  };
}

export async function upsertChannelTx(
  tx: Tx,
  owner: string,
  agentId: string,
  channel: ChannelConfig,
): Promise<void> {
  await upsertSlackChannel(tx, owner, agentId, channel);
}

export async function listChannelsByAgentTx(
  tx: Tx,
  owner: string,
  agentId: string,
): Promise<ChannelConfig[]> {
  const rows = await tx
    .select()
    .from(channels)
    .where(and(eq(channels.agentId, agentId), eq(channels.owner, owner)));
  return rows.map(toChannelConfig);
}

export function deleteChannelsByAgent(db: Db) {
  return async (agentId: string): Promise<void> => {
    await db.delete(channels).where(eq(channels.agentId, agentId));
  };
}

export function deleteChannelByType(db: Db, owner: string) {
  return async (agentId: string, type: ChannelType): Promise<void> => {
    await db
      .delete(channels)
      .where(
        and(
          eq(channels.agentId, agentId),
          eq(channels.owner, owner),
          eq(channels.type, type),
        ),
      );
  };
}

export function deleteChannelsByAgentIds(db: Db, owner: string) {
  return async (agentIds: string[]): Promise<void> => {
    if (agentIds.length === 0) return;
    const condition = owner
      ? and(inArray(channels.agentId, agentIds), eq(channels.owner, owner))
      : inArray(channels.agentId, agentIds);
    await db.delete(channels).where(condition);
  };
}

export function allChannelAgentIds(db: Db) {
  return async (): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ agentId: channels.agentId })
      .from(channels);
    return rows.map((r) => r.agentId);
  };
}

export function findBySlackChannelId(db: Db) {
  return async (
    slackChannelId: string,
  ): Promise<{
    agentId: string;
    owner: string;
    ambient?: boolean;
  } | null> => {
    const rows = await db
      .select({
        agentId: channels.agentId,
        owner: channels.owner,
        ambient: sql<string | null>`${channels.config}->>'ambient'`,
      })
      .from(channels)
      .where(
        and(
          eq(channels.type, ChannelType.Slack),
          sql`${channels.config}->>'slackChannelId' = ${slackChannelId}`,
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      agentId: row.agentId,
      owner: row.owner,
      ...(row.ambient === "true" ? { ambient: true } : {}),
    };
  };
}

export function setSlackChannelAmbient(db: Db) {
  return async (slackChannelId: string, ambient: boolean): Promise<void> => {
    await db
      .update(channels)
      .set({
        config: ambient
          ? sql`${channels.config} || '{"ambient": true}'::jsonb`
          : sql`${channels.config} - 'ambient'`,
      })
      .where(
        and(
          eq(channels.type, ChannelType.Slack),
          sql`${channels.config}->>'slackChannelId' = ${slackChannelId}`,
        ),
      );
  };
}

export function isSlackChannelUniqueViolation(e: unknown): boolean {
  return isUniqueViolation(e, "channels_slack_channel_unique_idx");
}

export function deleteSlackChannelBinding(db: Db) {
  return async (slackChannelId: string): Promise<void> => {
    await db
      .delete(channels)
      .where(
        and(
          eq(channels.type, ChannelType.Slack),
          sql`${channels.config}->>'slackChannelId' = ${slackChannelId}`,
        ),
      );
  };
}

export function findSlackChannelsByAgent(db: Db) {
  return async (agentId: string): Promise<string[]> => {
    const rows = await db
      .select({ config: channels.config })
      .from(channels)
      .where(
        and(
          eq(channels.agentId, agentId),
          eq(channels.type, ChannelType.Slack),
        ),
      )
      .orderBy(sql`${channels.config}->>'slackChannelId'`);
    return rows
      .map((r) => (r.config as { slackChannelId?: string }).slackChannelId)
      .filter((id): id is string => !!id);
  };
}

export function deleteSlackChannelByAgent(db: Db, owner: string) {
  return async (agentId: string, slackChannelId: string): Promise<boolean> => {
    const deleted = await db
      .delete(channels)
      .where(
        and(
          eq(channels.agentId, agentId),
          eq(channels.owner, owner),
          eq(channels.type, ChannelType.Slack),
          sql`${channels.config}->>'slackChannelId' = ${slackChannelId}`,
        ),
      )
      .returning({ agentId: channels.agentId });
    return deleted.length > 0;
  };
}
