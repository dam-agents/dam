import { randomBytes } from "node:crypto";
import {
  agents,
  and,
  asc,
  channels,
  connectionGrants,
  connections,
  eq,
  inArray,
  isNull,
  or,
  profileDefaults,
  profileSeeds,
  profiles,
  schedules,
  sql,
  telegramConversations,
  type Db,
  type DbTx,
} from "db";
import type { SubPseudonymizer } from "../../../core/sub-pseudonymizer.js";
import type { SessionSettings } from "agent-runtime-api";
import { PROVIDER_TEMPLATE_IDS, type AliasedConnection } from "api-server-api";

export const SEEDED_DEFAULT = "seeded-default";

export type ProfileRow = Omit<typeof profiles.$inferSelect, "settings"> & {
  settings: SessionSettings;
};

export type ProfileWrite = Pick<
  ProfileRow,
  "name" | "harness" | "providerTemplate" | "model" | "settings"
>;

/** UNIT_BOUNDARY_DESCRIPTION: every row that points at a profile, which is both the usage a list counts and what refuses a delete; `profileId` lets one query serve one profile or all of them. */
export interface ProfileReferences {
  agents: { id: string; chat: string | null; platform: string | null }[];
  channels: { profileId: string; agentId: string; label: string }[];
  schedules: { profileId: string; id: string; name: string; agentId: string }[];
}

const toRow = (row: typeof profiles.$inferSelect): ProfileRow => ({
  ...row,
  settings: row.settings as SessionSettings,
});

export type ProfilesRepository = ReturnType<typeof createProfilesRepository>;

export function createProfilesRepository(db: Db, pseudo: SubPseudonymizer) {
  async function references(
    executor: Db | DbTx,
    owner: string,
    agentIds: readonly string[] | undefined,
    profileId?: string,
  ): Promise<ProfileReferences> {
    if (agentIds?.length === 0)
      return { agents: [], channels: [], schedules: [] };
    const scoped = (column: Parameters<typeof inArray>[0]) =>
      agentIds === undefined ? undefined : inArray(column, [...agentIds]);
    const scheduleProfile = sql<string>`${schedules.spec}->>'profile'`;
    const [agentRows, channelRows, telegramRows, scheduleRows] =
      await Promise.all([
        executor
          .select({
            id: agents.id,
            chat: agents.sessionProfile,
            platform: agents.platformSubagentProfile,
          })
          .from(agents)
          .where(
            and(
              eq(agents.ownerSub, pseudo.hashSub(owner)),
              profileId === undefined
                ? or(
                    sql`${agents.sessionProfile} is not null`,
                    sql`${agents.platformSubagentProfile} is not null`,
                  )
                : or(
                    eq(agents.sessionProfile, profileId),
                    eq(agents.platformSubagentProfile, profileId),
                  ),
              scoped(agents.id),
            ),
          ),
        executor
          .select({
            profileId: sql<string>`${channels.profileId}`,
            agentId: channels.agentId,
            label: sql<string>`coalesce(${channels.config}->>'slackChannelId', ${channels.config}->>'conversationId', ${channels.type})`,
          })
          .from(channels)
          .where(
            and(
              eq(channels.owner, owner),
              profileId === undefined
                ? sql`${channels.profileId} is not null`
                : eq(channels.profileId, profileId),
              scoped(channels.agentId),
            ),
          ),
        executor
          .select({
            profileId: sql<string>`${telegramConversations.profileId}`,
            agentId: telegramConversations.agentId,
            label: telegramConversations.conversationId,
          })
          .from(telegramConversations)
          .where(
            and(
              profileId === undefined
                ? sql`${telegramConversations.profileId} is not null`
                : eq(telegramConversations.profileId, profileId),
              scoped(telegramConversations.agentId),
            ),
          ),
        executor
          .select({
            profileId: scheduleProfile,
            id: schedules.id,
            name: schedules.name,
            agentId: schedules.agentId,
          })
          .from(schedules)
          .where(
            and(
              eq(schedules.owner, owner),
              profileId === undefined
                ? sql`${scheduleProfile} is not null`
                : sql`${scheduleProfile} = ${profileId}`,
              scoped(schedules.agentId),
            ),
          ),
      ]);
    return {
      agents: agentRows,
      channels: [...channelRows, ...telegramRows],
      schedules: scheduleRows,
    };
  }

  const connectionColumns = {
    id: connections.id,
    name: connections.name,
    templateId: connections.templateId,
  };

  return {
    references: (
      owner: string,
      agentIds: readonly string[] | undefined,
      profileId?: string,
    ) => references(db, owner, agentIds, profileId),

    async list(owner: string): Promise<ProfileRow[]> {
      const rows = await db
        .select()
        .from(profiles)
        .where(eq(profiles.owner, owner))
        .orderBy(profiles.createdAt, profiles.name);
      return rows.map(toRow);
    },

    /** UNIT_BOUNDARY_DESCRIPTION: without an owner, for a reference already stored on a row, whose id is the authority. */
    async get(id: string, owner?: string): Promise<ProfileRow | null> {
      const rows = await db
        .select()
        .from(profiles)
        .where(
          and(
            eq(profiles.id, id),
            owner === undefined ? undefined : eq(profiles.owner, owner),
          ),
        );
      return rows[0] ? toRow(rows[0]) : null;
    },

    async defaultOf(owner: string): Promise<ProfileRow | null> {
      const rows = await db
        .select({ profile: profiles })
        .from(profileDefaults)
        .innerJoin(profiles, eq(profiles.id, profileDefaults.profileId))
        .where(eq(profileDefaults.owner, owner));
      return rows[0] ? toRow(rows[0].profile) : null;
    },

    /** UNIT_BOUNDARY_DESCRIPTION: `onlyIfNone` marks a default only for an owner who has none yet, so two first reads cannot both pick one. */
    async setDefault(
      owner: string,
      profileId: string,
      { onlyIfNone = false } = {},
    ): Promise<void> {
      const insert = db.insert(profileDefaults).values({ owner, profileId });
      await (onlyIfNone
        ? insert.onConflictDoNothing()
        : insert.onConflictDoUpdate({
            target: profileDefaults.owner,
            set: { profileId },
          }));
    },

    async insert(owner: string, profile: ProfileWrite): Promise<ProfileRow> {
      const rows = await db
        .insert(profiles)
        .values({ id: newId(), owner, ...profile })
        .returning();
      return toRow(rows[0]!);
    },

    /** UNIT_BOUNDARY_DESCRIPTION: `expect` makes the write a compare-and-set: it lands only while the row is still the version the caller wrote, so a write that only undoes another one cannot undo a later edit. `at` names the version the row is written as. */
    async update(
      owner: string,
      id: string,
      profile: Partial<ProfileWrite>,
      options: { expect?: Date; at?: Date } = {},
    ): Promise<ProfileRow | null> {
      const rows = await db
        .update(profiles)
        .set({ ...profile, updatedAt: options.at ?? new Date() })
        .where(
          and(
            eq(profiles.owner, owner),
            eq(profiles.id, id),
            ...(options.expect ? [eq(profiles.updatedAt, options.expect)] : []),
          ),
        )
        .returning();
      return rows[0] ? toRow(rows[0]) : null;
    },

    /** UNIT_BOUNDARY_DESCRIPTION: the profile row is locked while usage is rechecked, so a schedule assigned during the delete (a JSON reference no foreign key guards) is seen or finds the row gone. */
    deleteIfUnused(
      owner: string,
      id: string,
      agentIds: readonly string[] | undefined,
    ): Promise<"deleted" | "missing" | ProfileReferences> {
      return db.transaction(async (tx: DbTx) => {
        const held = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(and(eq(profiles.owner, owner), eq(profiles.id, id)))
          .for("update");
        if (held.length === 0) return "missing";
        const used = await references(tx, owner, agentIds, id);
        if (
          used.agents.length + used.channels.length + used.schedules.length >
          0
        )
          return used;
        await tx.delete(profiles).where(eq(profiles.id, id));
        return "deleted";
      });
    },

    /** UNIT_BOUNDARY_DESCRIPTION: the marker and the profile commit together, so a renamed or deleted seed never returns and a failed seed retries. */
    async seed(owner: string, profile: ProfileWrite): Promise<void> {
      await db.transaction(async (tx: DbTx) => {
        const claimed = await tx
          .insert(profileSeeds)
          .values({ owner })
          .onConflictDoNothing()
          .returning({ owner: profileSeeds.owner });
        if (claimed.length === 0) return;
        await tx
          .insert(profiles)
          .values({ id: newId(), owner, seed: SEEDED_DEFAULT, ...profile })
          .onConflictDoNothing();
      });
    },

    /** UNIT_BOUNDARY_DESCRIPTION: a new agent's row is written by the agent-created saga, which can run after the create returns, so the bind inserts it when it is not there yet; the saga's upsert keeps the reference. False when the agent already holds a chat default. */
    async bindChatProfile(
      owner: string,
      agentId: string,
      profileId: string,
    ): Promise<boolean> {
      const ownerSub = pseudo.hashSub(owner);
      const bound = await db
        .insert(agents)
        .values({ id: agentId, ownerSub, sessionProfile: profileId })
        .onConflictDoUpdate({
          target: agents.id,
          set: { sessionProfile: profileId },
          setWhere: and(
            eq(agents.ownerSub, ownerSub),
            isNull(agents.sessionProfile),
            isNull(agents.sessionPair),
          ),
        })
        .returning({ id: agents.id });
      return bound.length > 0;
    },

    ownerConnections(owner: string): Promise<AliasedConnection[]> {
      return db
        .select(connectionColumns)
        .from(connections)
        .where(
          and(
            eq(connections.owner, owner),
            inArray(connections.templateId, [...PROVIDER_TEMPLATE_IDS]),
          ),
        )
        .orderBy(asc(connections.createdAt));
    },

    agentConnections(
      owner: string,
      agentId: string,
    ): Promise<AliasedConnection[]> {
      return db
        .select(connectionColumns)
        .from(connectionGrants)
        .innerJoin(
          connections,
          eq(connectionGrants.connectionId, connections.id),
        )
        .where(
          and(
            eq(connectionGrants.agentId, agentId),
            eq(connections.owner, owner),
            inArray(connections.templateId, [...PROVIDER_TEMPLATE_IDS]),
          ),
        );
    },
  };
}

const newId = () => `profile-${randomBytes(6).toString("hex")}`;
