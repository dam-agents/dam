import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  agents as agentsTable,
  connectionGrants,
  connections as connectionsTable,
  type Db,
  type DbTx,
} from "db";
import { match } from "ts-pattern";
import {
  orderByAlias,
  PROVIDER_TEMPLATE_IDS,
  providerTypeForTemplateId,
  sessionPairSchema,
  type DefaultKind,
  type SessionDefaults,
  type SessionPair,
} from "api-server-api";
import type { DefaultModelNote } from "../domain/default-model-notice.js";
import type { GrantedProvider } from "../domain/session-pair.js";
import type { StoredProfileResolver } from "../../profiles/index.js";

export interface SessionPairReferences {
  sessionProfile: string | null;
  platformSubagentProfile: string | null;
}

export interface SessionPairRepo {
  /** UNIT_BOUNDARY_DESCRIPTION: the effective pair of each kind, with every profile reference resolved, so no reader has to know a reference exists. */
  read(agentId: string, kind: DefaultKind): Promise<SessionPair | null>;
  readSaved(agentId: string, lockIn?: DbTx): Promise<SessionDefaults>;
  /** UNIT_BOUNDARY_DESCRIPTION: the stored references themselves, for the writes that edit them rather than run on them. */
  readReferences(agentId: string): Promise<SessionPairReferences>;
  write(
    agentId: string,
    kind: DefaultKind,
    pair: SessionPair,
    references?: {
      profileId?: string | null;
      platformSubagentProfileId?: string | null;
    },
  ): Promise<void>;
  clear(agentId: string, kind: Exclude<DefaultKind, "chat">): Promise<void>;
  grantedProviders(agentId: string): Promise<GrantedProvider[]>;
}

const parsePair = (value: unknown): SessionPair | null => {
  const parsed = sessionPairSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export interface FillableSessionPairRepo extends SessionPairRepo {
  writeIfEmpty(
    agentId: string,
    pair: SessionPair,
    note?: DefaultModelNote,
  ): Promise<boolean>;
}

export function createSessionPairRepo(
  db: Db,
  profiles?: StoredProfileResolver,
): FillableSessionPairRepo {
  /* UNIT_BOUNDARY_DESCRIPTION: a reference that cannot run right now resolves to
   * no pair, which every caller already reads as "the agent has no default" and
   * reports; resolving must never substitute another harness or model. */
  async function chatPair(
    agentId: string,
    stored: SessionPair | null,
    references: SessionPairReferences,
  ): Promise<SessionPair | null> {
    if (references.sessionProfile === null) return stored;
    if (profiles === undefined) return null;
    const resolved = await profiles.resolveStored({
      profileId: references.sessionProfile,
      agentId,
    });
    return resolved?.unavailable === null ? resolved.pair : null;
  }

  async function readSaved(
    agentId: string,
    lockIn?: DbTx,
  ): Promise<SessionDefaults> {
    const query = (lockIn ?? db)
      .select({
        chat: agentsTable.sessionPair,
        channel: agentsTable.channelSessionPair,
        scheduled: agentsTable.scheduledSessionPair,
        sessionProfile: agentsTable.sessionProfile,
        platformSubagentProfile: agentsTable.platformSubagentProfile,
      })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    const rows = await (lockIn ? query.for("update") : query);
    const references = {
      sessionProfile: rows[0]?.sessionProfile ?? null,
      platformSubagentProfile: rows[0]?.platformSubagentProfile ?? null,
    };
    return {
      chat: await chatPair(agentId, parsePair(rows[0]?.chat), references),
      channel: parsePair(rows[0]?.channel),
      scheduled: parsePair(rows[0]?.scheduled),
    };
  }

  async function readReferences(
    agentId: string,
  ): Promise<SessionPairReferences> {
    const rows = await db
      .select({
        sessionProfile: agentsTable.sessionProfile,
        platformSubagentProfile: agentsTable.platformSubagentProfile,
      })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    return {
      sessionProfile: rows[0]?.sessionProfile ?? null,
      platformSubagentProfile: rows[0]?.platformSubagentProfile ?? null,
    };
  }

  return {
    readSaved,

    async read(agentId, kind) {
      const saved = await readSaved(agentId);
      return match(kind)
        .with("chat", () => saved.chat)
        .with("channel", () => saved.channel ?? saved.chat)
        .with("scheduled", () => saved.scheduled ?? saved.chat)
        .exhaustive();
    },

    readReferences,

    async write(agentId, kind, pair, references) {
      await db
        .update(agentsTable)
        .set(
          /* UNIT_BOUNDARY_DESCRIPTION: a custom pick is the chat default
           * instead of a profile, so writing one detaches the agent from the
           * profile it pointed at rather than holding both. */
          match(kind)
            .with("chat", () => ({
              sessionPair: references?.profileId ? null : pair,
              sessionProfile: references?.profileId ?? null,
              ...(references?.platformSubagentProfileId !== undefined && {
                platformSubagentProfile: references.platformSubagentProfileId,
              }),
              defaultModelNote: null,
            }))
            .with("channel", () => ({ channelSessionPair: pair }))
            .with("scheduled", () => ({ scheduledSessionPair: pair }))
            .exhaustive(),
        )
        .where(eq(agentsTable.id, agentId));
    },

    async clear(agentId, kind) {
      await db
        .update(agentsTable)
        .set(
          match(kind)
            .with("channel", () => ({ channelSessionPair: null }))
            .with("scheduled", () => ({ scheduledSessionPair: null }))
            .exhaustive(),
        )
        .where(eq(agentsTable.id, agentId));
    },

    /* UNIT_BOUNDARY_DESCRIPTION: an agent whose chat default is a profile is
     * already configured, so the one-time conversion never writes a custom pair
     * beside the reference (the XOR check would refuse it anyway). */
    async writeIfEmpty(agentId, pair, note) {
      const rows = await db
        .update(agentsTable)
        .set({ sessionPair: pair, defaultModelNote: note ?? null })
        .where(
          and(
            eq(agentsTable.id, agentId),
            isNull(agentsTable.sessionPair),
            isNull(agentsTable.sessionProfile),
          ),
        )
        .returning({ id: agentsTable.id });
      return rows.length > 0;
    },

    async grantedProviders(agentId) {
      const rows = await db
        .select({
          id: connectionsTable.id,
          templateId: connectionsTable.templateId,
        })
        .from(connectionGrants)
        .innerJoin(
          connectionsTable,
          eq(connectionGrants.connectionId, connectionsTable.id),
        )
        .where(
          and(
            eq(connectionGrants.agentId, agentId),
            inArray(connectionsTable.templateId, [...PROVIDER_TEMPLATE_IDS]),
          ),
        )
        .orderBy(asc(connectionsTable.name), asc(connectionsTable.id));
      return orderByAlias(
        rows.flatMap((r) => {
          const type = providerTypeForTemplateId(r.templateId);
          return type ? [{ id: r.id, type, templateId: r.templateId }] : [];
        }),
      );
    },
  };
}
