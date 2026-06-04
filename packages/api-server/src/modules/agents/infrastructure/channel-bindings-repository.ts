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

export function upsertChannel(db: Db, owner: string) {
  return async (agentId: string, channel: ChannelConfig): Promise<void> => {
    const { type, ...config } = channel;
    await db
      .insert(channels)
      .values({ agentId, owner, type, config })
      .onConflictDoUpdate({
        target: [channels.agentId, channels.type],
        set: { config, owner },
      });
  };
}

export async function upsertChannelTx(
  tx: Tx,
  owner: string,
  agentId: string,
  channel: ChannelConfig,
): Promise<void> {
  const { type, ...config } = channel;
  await tx
    .insert(channels)
    .values({ agentId, owner, type, config })
    .onConflictDoUpdate({
      target: [channels.agentId, channels.type],
      set: { config, owner },
    });
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
  ): Promise<{ agentId: string } | null> => {
    const rows = await db
      .select({ agentId: channels.agentId })
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
  // Drizzle (>=0.44) wraps every driver failure in a DrizzleQueryError and
  // stashes the original postgres.js error — the one carrying `code` and
  // `constraint_name` — on `.cause`. Walk the cause chain so the guard matches
  // whether it is handed the raw driver error or the Drizzle wrapper.
  for (
    let cur: unknown = e, depth = 0;
    cur !== null && typeof cur === "object" && depth < 10;
    cur = (cur as { cause?: unknown }).cause, depth++
  ) {
    const obj = cur as { code?: unknown; constraint_name?: unknown };
    if (
      obj.code === "23505" &&
      obj.constraint_name === "channels_slack_channel_unique_idx"
    ) {
      return true;
    }
  }
  return false;
}

export function findSlackChannelByAgent(db: Db) {
  return async (agentId: string): Promise<string | null> => {
    const rows = await db
      .select({ config: channels.config })
      .from(channels)
      .where(
        and(
          eq(channels.agentId, agentId),
          eq(channels.type, ChannelType.Slack),
        ),
      )
      .limit(1);
    const cfg = rows[0]?.config as { slackChannelId?: string } | undefined;
    return cfg?.slackChannelId ?? null;
  };
}
