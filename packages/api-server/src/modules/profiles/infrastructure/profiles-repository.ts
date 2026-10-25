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
  isNotNull,
  or,
  profileSeeds,
  profiles,
  schedules,
  sql,
  type Db,
  type DbTx,
} from "db";
import { getLogger } from "../../../core/logger.js";
import type { SubPseudonymizer } from "../../../core/sub-pseudonymizer.js";
import type { SessionSettings } from "agent-runtime-api";
import {
  PROVIDER_TEMPLATE_IDS,
  profileSettingsSchema,
  type AliasedConnection,
  type ProfileSlot,
  type ProfileUsage,
  type ProfileUsageCounts,
} from "api-server-api";

/** UNIT_BOUNDARY_DESCRIPTION: the marker on the one profile every owner is seeded with, so a rename keeps it identifiable and a delete is not undone by the next list. */
export const SEEDED_DEFAULT = "seeded-default";

export interface ProfileRow {
  id: string;
  owner: string;
  name: string;
  seed: string | null;
  harness: string;
  providerTemplate: string;
  model: string;
  settings: SessionSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileWrite {
  name: string;
  harness: string;
  providerTemplate: string;
  model: string;
  settings: SessionSettings;
}

export type DeleteOutcome =
  | { outcome: "deleted" }
  | { outcome: "missing" }
  | { outcome: "in-use"; usage: ProfileUsage };

export interface ProfilesRepository {
  list(owner: string): Promise<ProfileRow[]>;
  get(owner: string, id: string): Promise<ProfileRow | null>;
  insert(owner: string, profile: ProfileWrite): Promise<ProfileRow>;
  update(
    owner: string,
    id: string,
    profile: Partial<ProfileWrite>,
  ): Promise<ProfileRow | null>;
  /** UNIT_BOUNDARY_DESCRIPTION: one transaction holds the profile row, so an assignment made while the delete runs is either seen by the usage recheck or refused by the vanished row. */
  deleteIfUnused(
    owner: string,
    id: string,
    binding?: readonly string[],
  ): Promise<DeleteOutcome>;
  /* UNIT_BOUNDARY_DESCRIPTION: a key limited to some agents sees usage of those
   * agents only, the way the owner-scoped schedule list narrows its rows. */
  usage(
    owner: string,
    id: string,
    binding?: readonly string[],
  ): Promise<ProfileUsage>;
  usageCounts(
    owner: string,
    binding?: readonly string[],
  ): Promise<Map<string, ProfileUsageCounts>>;
  /** UNIT_BOUNDARY_DESCRIPTION: the owner's seed marker and the seeded profile commit together, so a failed seed leaves no marker and the next list retries it. */
  seed(owner: string, profile: ProfileWrite | null): Promise<void>;
  /** UNIT_BOUNDARY_DESCRIPTION: the owner's provider Connections, which a profile's template resolves against. */
  ownerConnections(owner: string): Promise<AliasedConnection[]>;
  /** UNIT_BOUNDARY_DESCRIPTION: the provider Connections the agent is granted, the set a rival alias is looked for in. */
  agentConnections(
    owner: string,
    agentId: string,
  ): Promise<AliasedConnection[]>;
}

type Row = typeof profiles.$inferSelect;

function parseSettings(value: unknown): SessionSettings {
  const parsed = profileSettingsSchema.safeParse(value);
  if (!parsed.success) {
    getLogger().error(
      { err: parsed.error },
      "profile settings unparseable; serving them as empty",
    );
    return {};
  }
  return parsed.data;
}

function rowToProfile(row: Row): ProfileRow {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    seed: row.seed,
    harness: row.harness,
    providerTemplate: row.providerTemplate,
    model: row.model,
    settings: parseSettings(row.settings),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createProfilesRepository(
  db: Db,
  pseudo: SubPseudonymizer,
): ProfilesRepository {
  async function read(owner: string, id: string): Promise<ProfileRow | null> {
    const rows = await db
      .select()
      .from(profiles)
      .where(and(eq(profiles.owner, owner), eq(profiles.id, id)));
    return rows[0] ? rowToProfile(rows[0]) : null;
  }

  /* UNIT_BOUNDARY_DESCRIPTION: `agents` keeps its owner pseudonymised, so every
   * owner predicate against it hashes the caller's subject the way the Agent
   * store does; the other records keep the raw one. */
  const agentOwner = (owner: string) => pseudo.hashSub(owner);

  const boundTo = (binding?: readonly string[]) =>
    binding === undefined
      ? undefined
      : binding.length === 0
        ? []
        : [...binding];

  async function usageOf(
    executor: Db | DbTx,
    owner: string,
    id: string,
    binding?: readonly string[],
  ): Promise<ProfileUsage> {
    const agentIds = boundTo(binding);
    if (agentIds !== undefined && agentIds.length === 0)
      return { agents: [], channels: [], schedules: [] };
    const [agentRows, channelRows, scheduleRows] = await Promise.all([
      executor
        .select({
          id: agents.id,
          chat: agents.sessionProfile,
          platform: agents.platformSubagentProfile,
        })
        .from(agents)
        .where(
          and(
            eq(agents.ownerSub, agentOwner(owner)),
            or(
              eq(agents.sessionProfile, id),
              eq(agents.platformSubagentProfile, id),
            ),
            ...(agentIds === undefined ? [] : [inArray(agents.id, agentIds)]),
          ),
        ),
      executor
        .select({
          agentId: channels.agentId,
          label:
            sql<string>`coalesce(${channels.config}->>'slackChannelId', ${channels.config}->>'conversationId', ${channels.type})`.as(
              "label",
            ),
        })
        .from(channels)
        .where(
          and(
            eq(channels.owner, owner),
            eq(channels.profileId, id),
            ...(agentIds === undefined
              ? []
              : [inArray(channels.agentId, agentIds)]),
          ),
        ),
      executor
        .select({
          id: schedules.id,
          name: schedules.name,
          agentId: schedules.agentId,
        })
        .from(schedules)
        .where(
          and(
            eq(schedules.owner, owner),
            sql`${schedules.spec}->>'profile' = ${id}`,
            ...(agentIds === undefined
              ? []
              : [inArray(schedules.agentId, agentIds)]),
          ),
        ),
    ]);
    return {
      agents: agentRows.map((row) => {
        const slots: ProfileSlot[] = [];
        if (row.chat === id) slots.push("chat");
        if (row.platform === id) slots.push("platformSubagent");
        return { id: row.id, slots };
      }),
      channels: channelRows,
      schedules: scheduleRows,
    };
  }

  return {
    async list(owner) {
      const rows = await db
        .select()
        .from(profiles)
        .where(eq(profiles.owner, owner))
        .orderBy(profiles.createdAt, profiles.name);
      return rows.map(rowToProfile);
    },

    get: read,

    async insert(owner, profile) {
      const rows = await db
        .insert(profiles)
        .values({
          id: `profile-${randomBytes(6).toString("hex")}`,
          owner,
          ...profile,
        })
        .returning();
      return rowToProfile(rows[0]!);
    },

    async update(owner, id, profile) {
      const patch: Partial<typeof profiles.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (profile.name !== undefined) patch.name = profile.name;
      if (profile.harness !== undefined) patch.harness = profile.harness;
      if (profile.providerTemplate !== undefined)
        patch.providerTemplate = profile.providerTemplate;
      if (profile.model !== undefined) patch.model = profile.model;
      if (profile.settings !== undefined) patch.settings = profile.settings;
      const rows = await db
        .update(profiles)
        .set(patch)
        .where(and(eq(profiles.owner, owner), eq(profiles.id, id)))
        .returning();
      return rows[0] ? rowToProfile(rows[0]) : null;
    },

    async deleteIfUnused(owner, id, binding) {
      return db.transaction(async (tx: DbTx) => {
        const held = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(and(eq(profiles.owner, owner), eq(profiles.id, id)))
          .for("update");
        if (held.length === 0) return { outcome: "missing" };
        const usage = await usageOf(tx, owner, id, binding);
        if (
          usage.agents.length + usage.channels.length + usage.schedules.length >
          0
        )
          return { outcome: "in-use", usage };
        await tx
          .delete(profiles)
          .where(and(eq(profiles.owner, owner), eq(profiles.id, id)));
        return { outcome: "deleted" };
      });
    },

    usage: (owner, id, binding) => usageOf(db, owner, id, binding),

    async usageCounts(owner, binding) {
      const agentIds = boundTo(binding);
      if (agentIds !== undefined && agentIds.length === 0) return new Map();
      const counts = new Map<string, ProfileUsageCounts>();
      const add = (id: string | null, kind: keyof ProfileUsageCounts) => {
        if (id === null) return;
        const current = counts.get(id) ?? {
          agents: 0,
          channels: 0,
          schedules: 0,
        };
        counts.set(id, { ...current, [kind]: current[kind] + 1 });
      };
      const [agentRows, channelRows, scheduleRows] = await Promise.all([
        db
          .select({
            chat: agents.sessionProfile,
            platform: agents.platformSubagentProfile,
          })
          .from(agents)
          .where(
            and(
              eq(agents.ownerSub, agentOwner(owner)),
              or(
                isNotNull(agents.sessionProfile),
                isNotNull(agents.platformSubagentProfile),
              ),
              ...(agentIds === undefined ? [] : [inArray(agents.id, agentIds)]),
            ),
          ),
        db
          .select({ id: channels.profileId })
          .from(channels)
          .where(
            and(
              eq(channels.owner, owner),
              isNotNull(channels.profileId),
              ...(agentIds === undefined
                ? []
                : [inArray(channels.agentId, agentIds)]),
            ),
          ),
        db
          .select({ id: sql<string | null>`${schedules.spec}->>'profile'` })
          .from(schedules)
          .where(
            and(
              eq(schedules.owner, owner),
              sql`${schedules.spec}->>'profile' is not null`,
              ...(agentIds === undefined
                ? []
                : [inArray(schedules.agentId, agentIds)]),
            ),
          ),
      ]);
      /* UNIT_BOUNDARY_DESCRIPTION: an agent that names the same profile in both
       * of its slots is one agent using it, not two. */
      for (const row of agentRows) {
        add(row.chat, "agents");
        if (row.platform !== row.chat) add(row.platform, "agents");
      }
      for (const row of channelRows) add(row.id, "channels");
      for (const row of scheduleRows) add(row.id, "schedules");
      return counts;
    },

    async seed(owner, profile) {
      await db.transaction(async (tx: DbTx) => {
        const claimed = await tx
          .insert(profileSeeds)
          .values({ owner })
          .onConflictDoNothing()
          .returning({ owner: profileSeeds.owner });
        if (claimed.length === 0 || profile === null) return;
        await tx
          .insert(profiles)
          .values({
            id: `profile-${randomBytes(6).toString("hex")}`,
            owner,
            seed: SEEDED_DEFAULT,
            ...profile,
          })
          .onConflictDoNothing();
      });
    },

    async ownerConnections(owner) {
      return db
        .select({
          id: connections.id,
          name: connections.name,
          templateId: connections.templateId,
        })
        .from(connections)
        .where(
          and(
            eq(connections.owner, owner),
            inArray(connections.templateId, [...PROVIDER_TEMPLATE_IDS]),
          ),
        )
        .orderBy(asc(connections.createdAt));
    },

    async agentConnections(owner, agentId) {
      return db
        .select({
          id: connections.id,
          name: connections.name,
          templateId: connections.templateId,
        })
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
