import { and, eq, inArray, type Db } from "db";
import {
  controlAgentConditions,
  controlAgentKitState,
  controlAgentL7Hosts,
  controlAgentSignals,
  controlAgentStatus,
  controlAgents,
  connectionGrants,
} from "db";
import type { AgentRows } from "./rows.js";

const CHUNK = 500;

const chunks = <T>(items: T[]): T[][] => {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += CHUNK)
    out.push(items.slice(index, index + CHUNK));
  return out;
};

const signalOf = (agentId: string): AgentRows["signals"] => ({
  agentId,
  version: 0,
  lastActivityAt: null,
  lastActivityToken: null,
  sessionPinned: false,
  invocationPinned: false,
  invocationPinVersion: 0,
  stopRequestToken: null,
  stopRequestedAt: null,
  disabledAt: null,
  rollRev: "",
  reclaimedAt: null,
  reclaimedActivityToken: null,
  updatedAt: new Date(0),
});

/**
 * UNIT_BOUNDARY_DESCRIPTION: the api-server's only read path into the control
 * tables, the controller's observation tables included — which is why the name
 * says so, and why the guard test holds this module to selects.
 * It reads a set of Agents as the rows that hold them,
 * with their signals, kit bookkeeping, observations, hosts and connection
 * grants, in a fixed number of queries rather than a join that repeats a
 * definition per host.
 *
 * It is one place because every reader needs the same whole: a cache listing
 * the fleet, a single Agent by id, and the writers that decide a change from a
 * live read all hand what comes back to the same mapping. A definition with no
 * signals row is read with empty signals rather than treated as missing — the
 * writer creates both in one transaction, and a reader that cannot see the
 * second yet must not report the first as absent.
 */
export async function readAgentRows(
  db: Db,
  ids?: string[],
): Promise<AgentRows[]> {
  const definitions =
    ids === undefined
      ? await db.select().from(controlAgents)
      : ids.length === 0
        ? []
        : (
            await Promise.all(
              chunks(ids).map((chunk) =>
                db
                  .select()
                  .from(controlAgents)
                  .where(inArray(controlAgents.id, chunk)),
              ),
            )
          ).flat();
  if (definitions.length === 0) return [];

  const agentIds = definitions.map((row) => row.id);
  const [signals, kits, statuses, conditions, hosts, grants] =
    await Promise.all([
      db
        .select()
        .from(controlAgentSignals)
        .where(inArray(controlAgentSignals.agentId, agentIds)),
      db
        .select()
        .from(controlAgentKitState)
        .where(inArray(controlAgentKitState.agentId, agentIds)),
      db
        .select()
        .from(controlAgentStatus)
        .where(inArray(controlAgentStatus.agentId, agentIds)),
      db
        .select()
        .from(controlAgentConditions)
        .where(inArray(controlAgentConditions.agentId, agentIds)),
      db
        .select()
        .from(controlAgentL7Hosts)
        .where(inArray(controlAgentL7Hosts.agentId, agentIds)),
      db
        .select({
          agentId: connectionGrants.agentId,
          connectionId: connectionGrants.connectionId,
        })
        .from(connectionGrants)
        .where(inArray(connectionGrants.agentId, agentIds)),
    ]);

  const byAgent = <T extends { agentId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.agentId) ?? [];
      list.push(row);
      map.set(row.agentId, list);
    }
    return map;
  };
  const signalsBy = new Map(signals.map((row) => [row.agentId, row]));
  const kitsBy = new Map(kits.map((row) => [row.agentId, row]));
  const statusesBy = new Map(statuses.map((row) => [row.agentId, row]));
  const conditionsBy = byAgent(conditions);
  const hostsBy = byAgent(hosts);
  const grantsBy = byAgent(grants);

  return definitions.map((agent) => ({
    agent,
    signals: signalsBy.get(agent.id) ?? signalOf(agent.id),
    kit: kitsBy.get(agent.id) ?? null,
    status: statusesBy.get(agent.id) ?? null,
    conditions: (conditionsBy.get(agent.id) ?? []).sort((a, b) =>
      a.type < b.type ? -1 : a.type > b.type ? 1 : 0,
    ),
    hosts: (hostsBy.get(agent.id) ?? []).map((row) => row.host).sort(),
    grants: (grantsBy.get(agent.id) ?? [])
      .map((row) => row.connectionId)
      .sort(),
  }));
}

export async function readOneAgent(
  db: Db,
  id: string,
): Promise<AgentRows | null> {
  const rows = await readAgentRows(db, [id]);
  return rows[0] ?? null;
}

export async function agentExists(
  db: Db,
  id: string,
  ownerSub?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: controlAgents.id })
    .from(controlAgents)
    .where(
      ownerSub === undefined
        ? eq(controlAgents.id, id)
        : and(eq(controlAgents.id, id), eq(controlAgents.ownerSub, ownerSub)),
    )
    .limit(1);
  return rows.length > 0;
}
