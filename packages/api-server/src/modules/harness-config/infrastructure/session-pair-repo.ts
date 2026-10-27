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
  type SessionDefaultsView,
  type SessionPair,
} from "api-server-api";
import type { DefaultModelNote } from "../domain/default-model-notice.js";
import {
  platformSubagentOf,
  splitPlatformSubagent,
  withoutPairApproval,
  withPlatformSubagent,
  type GrantedProvider,
} from "../domain/session-pair.js";
import { harnessCapability } from "agent-runtime-api";
import { z } from "zod";
import type { ProfileResolver } from "../../profiles/index.js";

export interface SessionPairRepo {
  /** UNIT_BOUNDARY_DESCRIPTION: the effective pair of each kind, with every profile reference resolved, so no reader has to know a reference exists. */
  read(agentId: string, kind: DefaultKind): Promise<SessionPair | null>;
  readSaved(agentId: string, lockIn?: DbTx): Promise<SessionDefaultsView>;
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
  resolveProfile: ProfileResolver,
): FillableSessionPairRepo {
  /* UNIT_BOUNDARY_DESCRIPTION: a chat profile that cannot run resolves to no pair, which every reader already reports as no default; it never falls back to another harness or model. A platform sub-agent profile that cannot run leaves the pair as it is, and the spawn refuses it with its reason. */
  async function readSaved(
    agentId: string,
    lockIn?: DbTx,
  ): Promise<SessionDefaultsView> {
    const query = (lockIn ?? db)
      .select({
        chat: agentsTable.sessionPair,
        channel: agentsTable.channelSessionPair,
        scheduled: agentsTable.scheduledSessionPair,
        sessionProfile: agentsTable.sessionProfile,
        platformSubagentProfile: agentsTable.platformSubagentProfile,
        platformSubagentSettings: agentsTable.platformSubagentSettings,
        capabilities: agentsTable.runtimeCapabilities,
      })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    const row = (await (lockIn ? query.for("update") : query))[0];
    const carried =
      z
        .array(harnessCapability)
        .safeParse(
          (row?.capabilities as { harnesses?: unknown } | null)?.harnesses,
        ).data ?? [];
    const plain = (pair: SessionPair | null) =>
      pair &&
      withoutPairApproval(
        pair,
        carried.find((h) => h.name === pair.harness)?.harnessConfigCatalog,
      );
    const chatProfileId = row?.sessionProfile ?? null;
    const resolve = (profileId: string | null | undefined) =>
      profileId ? resolveProfile({ profileId, agentId }) : null;
    const [profile, slot] = await Promise.all([
      resolve(chatProfileId),
      resolve(row?.platformSubagentProfile),
    ]);
    const chat = chatProfileId
      ? profile?.unavailable === null
        ? profile.pair
        : null
      : parsePair(row?.chat);
    return {
      chat: plain(
        chat &&
          withPlatformSubagent(
            chat,
            row?.platformSubagentProfile
              ? slot?.unavailable === null
                ? platformSubagentOf(slot.pair)
                : null
              : ((row?.platformSubagentSettings as Record<
                  string,
                  string
                > | null) ?? null),
          ),
      ),
      channel: plain(parsePair(row?.channel)),
      scheduled: plain(parsePair(row?.scheduled)),
      chatProfileId,
      platformSubagentProfileId: row?.platformSubagentProfile ?? null,
      platformSubagentSettings:
        (row?.platformSubagentSettings as Record<string, string> | null) ??
        null,
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

    async write(agentId, kind, pair, references) {
      const [primary, slot] = splitPlatformSubagent(pair);
      const slotId = references?.platformSubagentProfileId;
      await db
        .update(agentsTable)
        .set(
          match(kind)
            .with("chat", () => ({
              sessionPair: references?.profileId ? null : primary,
              sessionProfile: references?.profileId ?? null,
              ...(slotId !== undefined && {
                platformSubagentProfile: slotId,
                platformSubagentSettings: slotId ? null : slot,
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
