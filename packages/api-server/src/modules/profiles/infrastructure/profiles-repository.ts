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
  libraryArtifacts,
  or,
  newAgentDefaults,
  profiles,
  schedules,
  sql,
  telegramConversations,
  type Db,
  type DbTx,
} from "db";
import type { SubPseudonymizer } from "../../../core/sub-pseudonymizer.js";
import type { SessionSettings } from "agent-runtime-api";
import {
  PROVIDER_TEMPLATE_IDS,
  type AliasedConnection,
  type SessionPair,
} from "api-server-api";

export type ProfileRow = Omit<typeof profiles.$inferSelect, "settings"> & {
  settings: SessionSettings;
};

export type ProfileWrite = Pick<
  ProfileRow,
  "name" | "harness" | "providerTemplate" | "model" | "settings"
> & {
  /* UNIT_BOUNDARY_DESCRIPTION: the sub-agent a profile names, absent where it names none, so a profile made without one writes none. */
  subagentProviderTemplate?: string | null;
  subagentModel?: string | null;
};

/** UNIT_BOUNDARY_DESCRIPTION: every row that points at a profile, which is both the usage a list counts and what refuses a delete; `profileId` lets one query serve one profile or all of them. */
export interface ProfileReferences {
  agents: { id: string; chat: string | null; platform: string | null }[];
  channels: { profileId: string; agentId: string; label: string }[];
  schedules: { profileId: string; id: string; name: string; agentId: string }[];
  artifacts: {
    profileId: string;
    id: string;
    title: string;
    agentId: string;
  }[];
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
      return { agents: [], channels: [], schedules: [], artifacts: [] };
    const scoped = (column: Parameters<typeof inArray>[0]) =>
      agentIds === undefined ? undefined : inArray(column, [...agentIds]);
    const scheduleProfile = sql<string | null>`${schedules.spec}->>'profile'`;
    const scheduleSubagent = sql<
      string | null
    >`${schedules.spec}->>'platformSubagentProfile'`;
    /* UNIT_BOUNDARY_DESCRIPTION: a binding or a schedule names a profile in either slot, as an agent's chat default does; one row naming it twice is one use. */
    const naming = (
      primary: Parameters<typeof eq>[0],
      subagent: Parameters<typeof eq>[0],
    ) =>
      profileId === undefined
        ? or(sql`${primary} is not null`, sql`${subagent} is not null`)
        : or(sql`${primary} = ${profileId}`, sql`${subagent} = ${profileId}`);
    const perProfile = <
      T extends { primary: string | null; subagent: string | null },
    >(
      rows: T[],
    ) =>
      rows.flatMap(({ primary, subagent, ...row }) =>
        [...new Set([primary, subagent])]
          .filter(
            (id): id is string =>
              id !== null && (profileId === undefined || id === profileId),
          )
          .map((id) => ({ ...row, profileId: id })),
      );
    const [agentRows, channelRows, telegramRows, scheduleRows, artifactRows] =
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
            primary: channels.profileId,
            subagent: channels.platformSubagentProfile,
            agentId: channels.agentId,
            label: sql<string>`coalesce(${channels.config}->>'slackChannelId', ${channels.config}->>'conversationId', ${channels.type})`,
          })
          .from(channels)
          .where(
            and(
              eq(channels.owner, owner),
              naming(channels.profileId, channels.platformSubagentProfile),
              scoped(channels.agentId),
            ),
          ),
        executor
          .select({
            primary: telegramConversations.profileId,
            subagent: telegramConversations.platformSubagentProfile,
            agentId: telegramConversations.agentId,
            label: telegramConversations.conversationId,
          })
          .from(telegramConversations)
          .where(
            and(
              naming(
                telegramConversations.profileId,
                telegramConversations.platformSubagentProfile,
              ),
              scoped(telegramConversations.agentId),
            ),
          ),
        executor
          .select({
            primary: scheduleProfile,
            subagent: scheduleSubagent,
            id: schedules.id,
            name: schedules.name,
            agentId: schedules.agentId,
          })
          .from(schedules)
          .where(
            and(
              eq(schedules.owner, owner),
              naming(scheduleProfile, scheduleSubagent),
              scoped(schedules.agentId),
            ),
          ),
        executor
          .select({
            primary: libraryArtifacts.promptProfileId,
            subagent: libraryArtifacts.promptSubagentProfile,
            id: libraryArtifacts.id,
            title: libraryArtifacts.title,
            agentId: sql<string>`${libraryArtifacts.agentId}`,
          })
          .from(libraryArtifacts)
          .where(
            and(
              eq(libraryArtifacts.owner, owner),
              naming(
                libraryArtifacts.promptProfileId,
                libraryArtifacts.promptSubagentProfile,
              ),
              scoped(libraryArtifacts.agentId),
            ),
          ),
      ]);
    return {
      agents: agentRows,
      channels: [...perProfile(channelRows), ...perProfile(telegramRows)],
      schedules: perProfile(scheduleRows),
      artifacts: perProfile(artifactRows),
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

    /** UNIT_BOUNDARY_DESCRIPTION: the default for new agents the owner chose: the profile it names, or its own values; null while they chose none. */
    async newAgentDefaultOf(
      owner: string,
    ): Promise<
      | { profile: ProfileRow; pair: null }
      | { profile: null; pair: SessionPair }
      | null
    > {
      const rows = await db
        .select({ profile: profiles, pair: newAgentDefaults.sessionPair })
        .from(newAgentDefaults)
        .leftJoin(profiles, eq(profiles.id, newAgentDefaults.profileId))
        .where(eq(newAgentDefaults.owner, owner));
      const row = rows[0];
      if (!row) return null;
      return row.profile
        ? { profile: toRow(row.profile), pair: null }
        : { profile: null, pair: row.pair as SessionPair };
    },

    async setNewAgentDefault(
      owner: string,
      chosen: { profileId: string } | { sessionPair: SessionPair },
    ): Promise<void> {
      const set =
        "profileId" in chosen
          ? { profileId: chosen.profileId, sessionPair: null }
          : { profileId: null, sessionPair: chosen.sessionPair };
      await db
        .insert(newAgentDefaults)
        .values({ owner, ...set })
        .onConflictDoUpdate({ target: newAgentDefaults.owner, set });
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
          used.agents.length +
            used.channels.length +
            used.schedules.length +
            used.artifacts.length >
          0
        )
          return used;
        await tx.delete(profiles).where(eq(profiles.id, id));
        return "deleted";
      });
    },

    /** UNIT_BOUNDARY_DESCRIPTION: a new agent's row is written by the agent-created saga, which can run after the create returns, so the bind inserts it when it is not there yet; the saga's upsert keeps the reference. False when the agent already holds a chat default. */
    async bindChatDefault(
      owner: string,
      agentId: string,
      chat: { sessionProfile: string } | { sessionPair: SessionPair },
    ): Promise<boolean> {
      const ownerSub = pseudo.hashSub(owner);
      const bound = await db
        .insert(agents)
        .values({ id: agentId, ownerSub, ...chat })
        .onConflictDoUpdate({
          target: agents.id,
          set: chat,
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
