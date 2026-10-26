import {
  and,
  eq,
  inArray,
  isNull,
  agents as agentsTable,
  connectionGrants,
  connections as connectionsTable,
  type Db,
} from "db";
import { routesByModelName } from "agent-runtime-api";
import {
  aliasForProviderType,
  PROVIDER_TEMPLATE_IDS,
  providerTypeForTemplateId,
  sessionPairSchema,
  type DefaultModelNotice,
  type SessionPair,
} from "api-server-api";

import {
  defaultModelNoteSchema,
  defaultModelNoticesOf,
} from "../domain/default-model-notice.js";
import { readUnattendedWork } from "./unattended-work.js";
import type { ProfileResolver } from "../../profiles/index.js";

const parsePair = (value: unknown): SessionPair | null => {
  const parsed = sessionPairSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the default-model notices of the given Agents
 * (an owner's, from the Agent store: the row's owner is pseudonymized), read
 * from the database alone so a sleeping Agent is never woken to draw Home;
 * sub-agents a session spawned are left out. What each Agent runs unattended is
 * read beside its default, since a default that stops runs is the owner's
 * problem only where such a run exists.
 */
export function createDefaultModelNoticeReader(
  db: Db,
  resolveProfile: ProfileResolver,
): (agentIds: readonly string[]) => Promise<DefaultModelNotice[]> {
  return async (agentIds) => {
    if (agentIds.length === 0) return [];
    const rows = await db
      .select({
        id: agentsTable.id,
        pair: agentsTable.sessionPair,
        channelPair: agentsTable.channelSessionPair,
        scheduledPair: agentsTable.scheduledSessionPair,
        sessionProfile: agentsTable.sessionProfile,
        note: agentsTable.defaultModelNote,
        capabilities: agentsTable.runtimeCapabilities,
      })
      .from(agentsTable)
      .where(
        and(
          inArray(agentsTable.id, [...agentIds]),
          isNull(agentsTable.deletedAt),
          isNull(agentsTable.spawnedByAgentId),
        ),
      );
    const withPair = rows.filter(
      (r) =>
        r.pair !== null ||
        r.channelPair !== null ||
        r.scheduledPair !== null ||
        r.sessionProfile !== null,
    );
    if (withPair.length === 0) return [];
    const grants = await db
      .select({
        agentId: connectionGrants.agentId,
        templateId: connectionsTable.templateId,
      })
      .from(connectionGrants)
      .innerJoin(
        connectionsTable,
        eq(connectionGrants.connectionId, connectionsTable.id),
      )
      .where(
        and(
          inArray(
            connectionGrants.agentId,
            withPair.map((r) => r.id),
          ),
          inArray(connectionsTable.templateId, [...PROVIDER_TEMPLATE_IDS]),
        ),
      );
    const granted = new Map<string, Set<string>>();
    for (const g of grants) {
      const type = providerTypeForTemplateId(g.templateId);
      if (type)
        granted.set(
          g.agentId,
          (granted.get(g.agentId) ?? new Set()).add(aliasForProviderType(type)),
        );
    }
    const unattended = await readUnattendedWork(
      db,
      withPair.map((r) => r.id),
    );
    const resolved = new Map(
      await Promise.all(
        withPair.map(
          async (r) =>
            [
              r.id,
              r.sessionProfile === null
                ? null
                : await resolveProfile({
                    profileId: r.sessionProfile,
                    agentId: r.id,
                  }),
            ] as const,
        ),
      ),
    );
    return withPair.flatMap((r) => {
      const note = defaultModelNoteSchema.safeParse(r.note);
      const profile = resolved.get(r.id);
      return defaultModelNoticesOf({
        agentId: r.id,
        routed: routesByModelName(r.capabilities),
        saved: {
          chat: profile ? profile.pair : parsePair(r.pair),
          channel: parsePair(r.channelPair),
          scheduled: parsePair(r.scheduledPair),
        },
        profileUnavailable: !!profile?.unavailable,
        note: note.success ? note.data : null,
        grantedAliases: granted.get(r.id) ?? new Set(),
        runsUnattended: unattended.has(r.id),
      });
    });
  };
}
