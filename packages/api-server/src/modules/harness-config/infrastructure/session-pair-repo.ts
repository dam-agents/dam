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

export interface SessionPairRepo {
  read(agentId: string, kind: DefaultKind): Promise<SessionPair | null>;
  readSaved(agentId: string, lockIn?: DbTx): Promise<SessionDefaults>;
  write(agentId: string, kind: DefaultKind, pair: SessionPair): Promise<void>;
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

export function createSessionPairRepo(db: Db): FillableSessionPairRepo {
  async function readSaved(
    agentId: string,
    lockIn?: DbTx,
  ): Promise<SessionDefaults> {
    const query = (lockIn ?? db)
      .select({
        chat: agentsTable.sessionPair,
        channel: agentsTable.channelSessionPair,
        scheduled: agentsTable.scheduledSessionPair,
      })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    const rows = await (lockIn ? query.for("update") : query);
    return {
      chat: parsePair(rows[0]?.chat),
      channel: parsePair(rows[0]?.channel),
      scheduled: parsePair(rows[0]?.scheduled),
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

    async write(agentId, kind, pair) {
      await db
        .update(agentsTable)
        .set(
          match(kind)
            .with("chat", () => ({ sessionPair: pair, defaultModelNote: null }))
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

    async writeIfEmpty(agentId, pair, note) {
      const rows = await db
        .update(agentsTable)
        .set({ sessionPair: pair, defaultModelNote: note ?? null })
        .where(
          and(eq(agentsTable.id, agentId), isNull(agentsTable.sessionPair)),
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
