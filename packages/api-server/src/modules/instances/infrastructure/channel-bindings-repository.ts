import type { Db } from "db";
import { channels, eq, and, inArray, sql } from "db";
import { ChannelType, type ChannelConfig } from "api-server-api";
import type { Tx } from "../../../core/unit-of-work.js";

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
      const list = map.get(row.instanceId) ?? [];
      list.push(toChannelConfig(row));
      map.set(row.instanceId, list);
    }
    return map;
  };
}

export function listChannelsByInstance(db: Db, owner: string) {
  return async (instanceId: string): Promise<ChannelConfig[]> => {
    const rows = await db
      .select()
      .from(channels)
      .where(
        and(eq(channels.instanceId, instanceId), eq(channels.owner, owner)),
      );
    return rows.map(toChannelConfig);
  };
}

export function upsertChannel(db: Db, owner: string) {
  return async (instanceId: string, channel: ChannelConfig): Promise<void> => {
    const { type, ...config } = channel;
    await db
      .insert(channels)
      .values({ instanceId, owner, type, config })
      .onConflictDoUpdate({
        target: [channels.instanceId, channels.type],
        set: { config, owner },
      });
  };
}

export async function upsertChannelTx(
  tx: Tx,
  owner: string,
  instanceId: string,
  channel: ChannelConfig,
): Promise<void> {
  const { type, ...config } = channel;
  await tx
    .insert(channels)
    .values({ instanceId, owner, type, config })
    .onConflictDoUpdate({
      target: [channels.instanceId, channels.type],
      set: { config, owner },
    });
}

export async function listChannelsByInstanceTx(
  tx: Tx,
  owner: string,
  instanceId: string,
): Promise<ChannelConfig[]> {
  const rows = await tx
    .select()
    .from(channels)
    .where(
      and(eq(channels.instanceId, instanceId), eq(channels.owner, owner)),
    );
  return rows.map(toChannelConfig);
}

export function deleteChannelsByInstance(db: Db) {
  return async (instanceId: string): Promise<void> => {
    await db.delete(channels).where(eq(channels.instanceId, instanceId));
  };
}

export function deleteChannelByType(db: Db, owner: string) {
  return async (instanceId: string, type: ChannelType): Promise<void> => {
    await db
      .delete(channels)
      .where(
        and(
          eq(channels.instanceId, instanceId),
          eq(channels.owner, owner),
          eq(channels.type, type),
        ),
      );
  };
}

export function deleteChannelsByInstanceIds(db: Db, owner: string) {
  return async (instanceIds: string[]): Promise<void> => {
    if (instanceIds.length === 0) return;
    const condition = owner
      ? and(
          inArray(channels.instanceId, instanceIds),
          eq(channels.owner, owner),
        )
      : inArray(channels.instanceId, instanceIds);
    await db.delete(channels).where(condition);
  };
}

export function allChannelInstanceIds(db: Db) {
  return async (): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ instanceId: channels.instanceId })
      .from(channels);
    return rows.map((r) => r.instanceId);
  };
}

export function findBySlackChannelId(db: Db) {
  return async (
    slackChannelId: string,
  ): Promise<{ instanceId: string } | null> => {
    const rows = await db
      .select({ instanceId: channels.instanceId })
      .from(channels)
      .where(
        and(
          eq(channels.type, ChannelType.Slack),
          sql`${channels.config}->>'slackChannelId' = ${slackChannelId}`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  };
}

export function isSlackChannelUniqueViolation(e: unknown): boolean {
  if (e === null || typeof e !== "object") return false;
  const obj = e as { code?: unknown; constraint_name?: unknown };
  return (
    obj.code === "23505" &&
    obj.constraint_name === "channels_slack_channel_unique_idx"
  );
}

export function findSlackChannelByInstance(db: Db) {
  return async (instanceId: string): Promise<string | null> => {
    const rows = await db
      .select({ config: channels.config })
      .from(channels)
      .where(
        and(
          eq(channels.instanceId, instanceId),
          eq(channels.type, ChannelType.Slack),
        ),
      )
      .limit(1);
    const cfg = rows[0]?.config as { slackChannelId?: string } | undefined;
    return cfg?.slackChannelId ?? null;
  };
}
