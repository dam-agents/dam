import type { Db } from "db";
import {
  and,
  asc,
  or,
  eq,
  inArray,
  lt,
  ne,
  notInArray,
  sql,
  satelliteGrants,
  satelliteJobs,
  satellites,
} from "db";
import type {
  JobStatus,
  SatelliteManifest,
  SatelliteTool,
} from "api-server-api";
import type { JobRow, SatelliteRow } from "../domain/types.js";
import { TERMINAL_STATUSES } from "../domain/types.js";

function toSatellite(r: typeof satellites.$inferSelect): SatelliteRow {
  return {
    owner: r.owner,
    name: r.name,
    description: r.description,
    host: r.host,
    maxConcurrent: r.maxConcurrent,
    tools: r.tools as SatelliteTool[],
    draining: r.draining,
    lastSeenAt: r.lastSeenAt,
  };
}

function toJob(r: typeof satelliteJobs.$inferSelect): JobRow {
  return {
    owner: r.owner,
    satellite: r.satellite,
    sequence: r.sequence,
    agentId: r.agentId,
    tool: r.tool,
    args: r.args as Record<string, unknown>,
    status: r.status as JobStatus,
    approvalId: r.approvalId,
    approved: r.approved,
    isError: r.isError,
    exitCode: r.exitCode,
    output: r.output,
    truncated: r.truncated,
    reason: r.reason,
    cancelRequested: r.cancelRequested,
    cancelSentAt: r.cancelSentAt,
    deliveredAt: r.deliveredAt,
    wokeAt: r.wokeAt,
    awaitedUntil: r.awaitedUntil,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    createdAt: r.createdAt,
  };
}

export function createSatellitesRepository(db: Db) {
  return {
    async upsertFromManifest(
      owner: string,
      manifest: SatelliteManifest,
      host: string | null,
      ceiling: number,
    ): Promise<void> {
      const maxConcurrent = Math.min(manifest.maxConcurrent, ceiling);
      await db
        .insert(satellites)
        .values({
          owner,
          name: manifest.name,
          description: manifest.description ?? null,
          host,
          maxConcurrent,
          tools: manifest.tools,
          draining: false,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [satellites.owner, satellites.name],
          set: {
            description: manifest.description ?? null,
            host,
            maxConcurrent,
            tools: manifest.tools,
            lastSeenAt: new Date(),
          },
        });
    },

    async get(owner: string, name: string): Promise<SatelliteRow | null> {
      const rows = await db
        .select()
        .from(satellites)
        .where(and(eq(satellites.owner, owner), eq(satellites.name, name)));
      return rows[0] ? toSatellite(rows[0]) : null;
    },

    async listForOwner(owner: string): Promise<SatelliteRow[]> {
      const rows = await db
        .select()
        .from(satellites)
        .where(eq(satellites.owner, owner))
        .orderBy(asc(satellites.name));
      return rows.map(toSatellite);
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Removes a Satellite and everything keyed on it.
     * The Jobs go too: a Job is keyed (owner, satellite, sequence), and the
     * sequence restarts at 1 for a Satellite registered under the same name
     * again, so rows left behind would collide with the first Jobs of its
     * successor. Their record goes with them, which is what removing the machine
     * asks for.
     */
    async remove(owner: string, name: string): Promise<void> {
      await db
        .delete(satelliteJobs)
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, name),
          ),
        );
      await db
        .delete(satelliteGrants)
        .where(
          and(eq(satelliteGrants.owner, owner), eq(satelliteGrants.name, name)),
        );
      await db
        .delete(satellites)
        .where(and(eq(satellites.owner, owner), eq(satellites.name, name)));
    },

    async touch(owner: string, name: string): Promise<void> {
      await db
        .update(satellites)
        .set({ lastSeenAt: new Date() })
        .where(and(eq(satellites.owner, owner), eq(satellites.name, name)));
    },

    async setDraining(
      owner: string,
      name: string,
      draining: boolean,
    ): Promise<void> {
      await db
        .update(satellites)
        .set({ lastSeenAt: new Date(), draining })
        .where(and(eq(satellites.owner, owner), eq(satellites.name, name)));
    },

    async grant(owner: string, name: string, agentId: string): Promise<void> {
      await db
        .insert(satelliteGrants)
        .values({ owner, name, agentId })
        .onConflictDoNothing();
    },

    async revoke(owner: string, name: string, agentId: string): Promise<void> {
      await db
        .delete(satelliteGrants)
        .where(
          and(
            eq(satelliteGrants.owner, owner),
            eq(satelliteGrants.name, name),
            eq(satelliteGrants.agentId, agentId),
          ),
        );
    },

    async grantedNames(
      agentId: string,
    ): Promise<{ owner: string; name: string }[]> {
      const rows = await db
        .select({ owner: satelliteGrants.owner, name: satelliteGrants.name })
        .from(satelliteGrants)
        .where(eq(satelliteGrants.agentId, agentId));
      return rows;
    },

    async grantedAgentIds(owner: string, name: string): Promise<string[]> {
      const rows = await db
        .select({ agentId: satelliteGrants.agentId })
        .from(satelliteGrants)
        .where(
          and(eq(satelliteGrants.owner, owner), eq(satelliteGrants.name, name)),
        );
      return rows.map((r) => r.agentId);
    },

    async activeJobs(owner: string, name: string): Promise<JobRow[]> {
      const rows = await db
        .select()
        .from(satelliteJobs)
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, name),
            notInArray(satelliteJobs.status, [...TERMINAL_STATUSES]),
          ),
        );
      return rows.map(toJob);
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Locks the Satellite's own row, then counts its
     * live Jobs and inserts. The order is the point: a lock over the Job rows
     * holds nothing when there are none, so two starts arriving together would
     * both read a count of zero and both insert — one more Job than the Manifest
     * declared, and one waiting behind another, which is the backlog the design
     * says cannot exist. The Satellite row exists whether or not any Job does,
     * so taking it first is what serializes the pair.
     */
    async insertJob(input: {
      owner: string;
      satellite: string;
      agentId: string;
      tool: string;
      args: Record<string, unknown>;
      status: JobStatus;
      expiresAt: Date;
      maxConcurrent: number;
      toolMax: number | null;
    }): Promise<JobRow | { full: true; total: number; forTool: number }> {
      return db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ next: satellites.nextSequence })
          .from(satellites)
          .where(
            and(
              eq(satellites.owner, input.owner),
              eq(satellites.name, input.satellite),
            ),
          )
          .for("update");
        if (locked === undefined)
          throw new Error(`satellite ${input.satellite} no longer exists`);

        const live = await tx
          .select({
            status: satelliteJobs.status,
            tool: satelliteJobs.tool,
          })
          .from(satelliteJobs)
          .where(
            and(
              eq(satelliteJobs.owner, input.owner),
              eq(satelliteJobs.satellite, input.satellite),
              notInArray(satelliteJobs.status, [...TERMINAL_STATUSES]),
            ),
          );
        const forTool = live.filter((row) => row.tool === input.tool).length;
        if (
          live.length >= input.maxConcurrent ||
          (input.toolMax !== null && forTool >= input.toolMax)
        )
          return { full: true as const, total: live.length, forTool };

        await tx
          .update(satellites)
          .set({ nextSequence: sql`${satellites.nextSequence} + 1` })
          .where(
            and(
              eq(satellites.owner, input.owner),
              eq(satellites.name, input.satellite),
            ),
          );
        const sequence = locked.next;
        const { maxConcurrent, toolMax, ...values } = input;
        void maxConcurrent;
        void toolMax;
        const [row] = await tx
          .insert(satelliteJobs)
          .values({ ...values, sequence })
          .returning();
        return toJob(row!);
      });
    },

    async getJob(
      owner: string,
      satellite: string,
      sequence: number,
    ): Promise<JobRow | null> {
      const rows = await db
        .select()
        .from(satelliteJobs)
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.sequence, sequence),
          ),
        );
      return rows[0] ? toJob(rows[0]) : null;
    },

    async listJobs(owner: string, satellite: string): Promise<JobRow[]> {
      const rows = await db
        .select()
        .from(satelliteJobs)
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
          ),
        )
        .orderBy(asc(satelliteJobs.sequence));
      return rows.map(toJob);
    },

    async claimQueued(
      owner: string,
      satellite: string,
      capacity: number,
      leaseUntil: Date,
    ): Promise<JobRow[]> {
      if (capacity <= 0) return [];
      return db.transaction(async (tx) => {
        const pending = await tx
          .select({ sequence: satelliteJobs.sequence })
          .from(satelliteJobs)
          .where(
            and(
              eq(satelliteJobs.owner, owner),
              eq(satelliteJobs.satellite, satellite),
              eq(satelliteJobs.status, "queued"),
            ),
          )
          .orderBy(asc(satelliteJobs.sequence))
          .limit(capacity)
          .for("update", { skipLocked: true });
        if (pending.length === 0) return [];
        const rows = await tx
          .update(satelliteJobs)
          .set({ status: "running", startedAt: new Date(), leaseUntil })
          .where(
            and(
              eq(satelliteJobs.owner, owner),
              eq(satelliteJobs.satellite, satellite),
              inArray(
                satelliteJobs.sequence,
                pending.map((p) => p.sequence),
              ),
            ),
          )
          .returning();
        return rows.map(toJob);
      });
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Hands over the cancellations waiting for this
     * Satellite, at most once per lease. The request stays set, because clearing
     * it on handover loses the cancellation outright if the poll response never
     * arrives; the send is stamped instead, and a stamp older than a lease is
     * re-sent to a worker that evidently did not act on it. Leaving it unstamped
     * would re-send on every poll, and a poll that always answers never rests.
     */
    async takeCancellations(
      owner: string,
      satellite: string,
      resendBefore: Date,
    ): Promise<JobRow[]> {
      const rows = await db
        .update(satelliteJobs)
        .set({ cancelSentAt: new Date() })
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.status, "running"),
            eq(satelliteJobs.cancelRequested, true),
            or(
              sql`${satelliteJobs.cancelSentAt} is null`,
              lt(satelliteJobs.cancelSentAt, resendBefore),
            ),
          ),
        )
        .returning();
      return rows.map(toJob);
    },

    async renewLeases(
      owner: string,
      satellite: string,
      sequences: number[],
      leaseUntil: Date,
    ): Promise<void> {
      if (sequences.length === 0) return;
      await db
        .update(satelliteJobs)
        .set({ leaseUntil })
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
            inArray(satelliteJobs.sequence, sequences),
            eq(satelliteJobs.status, "running"),
          ),
        );
    },

    async settle(
      owner: string,
      satellite: string,
      sequence: number,
      patch: {
        status: JobStatus;
        isError?: boolean;
        exitCode?: number | null;
        output?: string | null;
        truncated?: boolean;
        reason?: string | null;
      },
      expect?: JobStatus,
    ): Promise<JobRow | null> {
      const rows = await db
        .update(satelliteJobs)
        .set({
          ...patch,
          leaseUntil: null,
          endedAt: new Date(),
        })
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.sequence, sequence),
            notInArray(satelliteJobs.status, [...TERMINAL_STATUSES]),
            ...(expect ? [eq(satelliteJobs.status, expect)] : []),
          ),
        )
        .returning();
      return rows[0] ? toJob(rows[0]) : null;
    },

    async release(
      owner: string,
      satellite: string,
      sequence: number,
    ): Promise<void> {
      await db
        .update(satelliteJobs)
        .set({ status: "queued", approved: true, leaseUntil: null })
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.sequence, sequence),
            eq(satelliteJobs.status, "pending-approval"),
          ),
        );
    },

    async hold(
      owner: string,
      satellite: string,
      sequence: number,
    ): Promise<JobRow | null> {
      const rows = await db
        .update(satelliteJobs)
        .set({ status: "pending-approval", leaseUntil: null, startedAt: null })
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.sequence, sequence),
            eq(satelliteJobs.status, "running"),
          ),
        )
        .returning();
      return rows[0] ? toJob(rows[0]) : null;
    },

    async requestCancel(
      owner: string,
      satellite: string,
      sequence: number,
    ): Promise<void> {
      await db
        .update(satelliteJobs)
        .set({ cancelRequested: true })
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.sequence, sequence),
          ),
        );
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Renews a live wait's claim on an outcome. A
     * finished Job has two ways to reach its Agent — the blocking call it is
     * already sitting in, and a fresh turn for the ordinary case where nothing
     * is listening — and exactly one of them must carry it. The blocking call
     * owns it while it is actually blocking, which is what this lease says; the
     * delivery skips a Job whose lease has not lapsed. It is a lease rather than
     * a flag because a waiter can die mid-poll, and then the outcome has to
     * become deliverable again on its own.
     */
    /**
     * UNIT_BOUNDARY_DESCRIPTION: Takes the wait lease that stops outcome
     * delivery waking an Agent about a Job it is already sitting in a `wait`
     * for. The Agent is a predicate rather than something the caller is trusted
     * to have checked: this lease withholds an outcome, so a write that could
     * land on another Agent's Job would let one Agent keep another's result from
     * ever being delivered. A Job's Agent never changes, so naming it here also
     * makes the owner unnecessary — which is what lets the lease be the first
     * statement of a wait, before any read opens a window delivery can claim in.
     */
    async markAwaited(
      agentId: string,
      satellite: string,
      sequence: number,
      until: Date,
    ): Promise<boolean> {
      const rows = await db
        .update(satelliteJobs)
        .set({ awaitedUntil: until })
        .where(
          and(
            eq(satelliteJobs.agentId, agentId),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.sequence, sequence),
            sql`${satelliteJobs.deliveredAt} is null`,
          ),
        )
        .returning({ sequence: satelliteJobs.sequence });
      return rows.length > 0;
    },

    async releaseAwaited(
      agentId: string,
      satellite: string,
      sequence: number,
    ): Promise<void> {
      await db
        .update(satelliteJobs)
        .set({ awaitedUntil: null })
        .where(
          and(
            eq(satelliteJobs.agentId, agentId),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.sequence, sequence),
          ),
        );
    },

    async markSeen(
      agentId: string,
      satellite: string,
      sequence: number,
    ): Promise<boolean> {
      const now = new Date();
      const rows = await db
        .update(satelliteJobs)
        .set({ deliveredAt: now, wokeAt: now })
        .where(
          and(
            eq(satelliteJobs.agentId, agentId),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.sequence, sequence),
            sql`${satelliteJobs.deliveredAt} is null`,
          ),
        )
        .returning({ sequence: satelliteJobs.sequence });
      return rows.length > 0;
    },

    async claimUndeliveredOutcomes(
      agentId: string,
      limit: number,
    ): Promise<JobRow[]> {
      const oldest = await db
        .select({
          owner: satelliteJobs.owner,
          satellite: satelliteJobs.satellite,
          sequence: satelliteJobs.sequence,
        })
        .from(satelliteJobs)
        .where(
          and(
            eq(satelliteJobs.agentId, agentId),
            inArray(satelliteJobs.status, [...TERMINAL_STATUSES]),
            sql`${satelliteJobs.deliveredAt} is null`,
            sql`(${satelliteJobs.awaitedUntil} is null or ${satelliteJobs.awaitedUntil} < now())`,
          ),
        )
        .orderBy(satelliteJobs.endedAt)
        .limit(limit);
      if (oldest.length === 0) return [];

      const rows = await db
        .update(satelliteJobs)
        .set({ deliveredAt: new Date() })
        .where(
          and(
            eq(satelliteJobs.agentId, agentId),
            sql`${satelliteJobs.deliveredAt} is null`,
            or(
              ...oldest.map((key) =>
                and(
                  eq(satelliteJobs.owner, key.owner),
                  eq(satelliteJobs.satellite, key.satellite),
                  eq(satelliteJobs.sequence, key.sequence),
                ),
              ),
            ),
          ),
        )
        .returning();
      return rows.map(toJob);
    },

    async expireNow(
      owner: string,
      satellite: string,
      sequence: number,
    ): Promise<void> {
      await db
        .update(satelliteJobs)
        .set({ expiresAt: new Date() })
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.sequence, sequence),
          ),
        );
    },

    async releaseOutcomes(
      owner: string,
      satellite: string,
      sequences: number[],
    ): Promise<void> {
      if (sequences.length === 0) return;
      await db
        .update(satelliteJobs)
        .set({ deliveredAt: null })
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
            inArray(satelliteJobs.sequence, sequences),
          ),
        );
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Agents holding an outcome that has not reached
     * them. Two states qualify: the outcome was never claimed, and the outcome
     * was claimed but the Agent never woke — an Agent parked over budget cannot
     * wake, and the turn waits in the outbox until something starts it. Reading
     * only the unclaimed ones would leave exactly that Agent unserved.
     */
    async agentsWithPendingOutcomes(): Promise<string[]> {
      const rows = await db
        .selectDistinct({ agentId: satelliteJobs.agentId })
        .from(satelliteJobs)
        .where(
          and(
            inArray(satelliteJobs.status, [...TERMINAL_STATUSES]),
            sql`(${satelliteJobs.deliveredAt} is null or ${satelliteJobs.wokeAt} is null)`,
          ),
        );
      return rows.map((r) => r.agentId);
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: The Jobs an Agent has been told about but not
     * woken for. Claimed only: a released outcome has no turn written for it, so
     * waking would bring the Agent up with nothing to read. That one is
     * announced instead, which is the other half of the hourly sweep.
     */
    async undeliveredFor(
      agentId: string,
    ): Promise<{ satellite: string; sequence: number }[]> {
      const rows = await db
        .select({
          satellite: satelliteJobs.satellite,
          sequence: satelliteJobs.sequence,
        })
        .from(satelliteJobs)
        .where(
          and(
            eq(satelliteJobs.agentId, agentId),
            inArray(satelliteJobs.status, [...TERMINAL_STATUSES]),
            sql`${satelliteJobs.deliveredAt} is not null`,
            sql`${satelliteJobs.wokeAt} is null`,
          ),
        );
      return rows;
    },

    async markWoken(
      agentId: string,
      refs: { satellite: string; sequence: number }[],
    ): Promise<void> {
      if (refs.length === 0) return;
      await db
        .update(satelliteJobs)
        .set({ wokeAt: new Date() })
        .where(
          and(
            eq(satelliteJobs.agentId, agentId),
            or(
              ...refs.map((ref) =>
                and(
                  eq(satelliteJobs.satellite, ref.satellite),
                  eq(satelliteJobs.sequence, ref.sequence),
                ),
              ),
            ),
          ),
        );
    },

    async expiredLeases(now: Date): Promise<JobRow[]> {
      const rows = await db
        .select()
        .from(satelliteJobs)
        .where(
          and(
            eq(satelliteJobs.status, "running"),
            lt(satelliteJobs.leaseUntil, now),
          ),
        );
      return rows.map(toJob);
    },

    async listGrantedAgentIds(): Promise<string[]> {
      const grants = await db
        .selectDistinct({ agentId: satelliteGrants.agentId })
        .from(satelliteGrants);
      const jobs = await db
        .selectDistinct({ agentId: satelliteJobs.agentId })
        .from(satelliteJobs);
      return [
        ...new Set([
          ...grants.map((r) => r.agentId),
          ...jobs.map((r) => r.agentId),
        ]),
      ];
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Clears what a deleted Agent leaves behind. Its
     * grants go, and its Jobs that had not started are cancelled — a running one
     * is left alone, because the command is already executing on a machine the
     * platform cannot reach, and only dispatch was ever ours to stop. Its
     * finished Jobs stay until the retention sweep, so the audit trail keeps
     * what ran.
     */
    async revokeAgentGrants(agentId: string): Promise<void> {
      await db
        .delete(satelliteGrants)
        .where(eq(satelliteGrants.agentId, agentId));
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: The one rule every revocation shares —
     * revoking a grant, removing a Satellite, deleting an Agent. A Job that has
     * not reached a machine is settled, because only dispatch was ever ours to
     * stop; a running one is left alone, since its command is already executing
     * where the platform cannot reach. The settled rows come back so the caller
     * can tell the Agent and retire any approval they were holding, and their
     * expiry is pushed out so the outcome outlives the sweep that settles it.
     */
    async stopDispatch(
      scope: { owner?: string; satellite?: string; agentId?: string },
      reason: string,
      ttlMs: number,
      onlyExpiredBefore?: Date,
    ): Promise<JobRow[]> {
      const filters = [
        notInArray(satelliteJobs.status, [...TERMINAL_STATUSES, "running"]),
        ...(onlyExpiredBefore
          ? [lt(satelliteJobs.expiresAt, onlyExpiredBefore)]
          : []),
        ...(scope.owner ? [eq(satelliteJobs.owner, scope.owner)] : []),
        ...(scope.satellite
          ? [eq(satelliteJobs.satellite, scope.satellite)]
          : []),
        ...(scope.agentId ? [eq(satelliteJobs.agentId, scope.agentId)] : []),
      ];
      const rows = await db
        .update(satelliteJobs)
        .set({
          status: "cancelled",
          reason,
          endedAt: new Date(),
          leaseUntil: null,
          expiresAt: new Date(Date.now() + ttlMs),
        })
        .where(and(...filters))
        .returning();
      return rows.map(toJob);
    },

    async setApprovalId(
      owner: string,
      satellite: string,
      sequence: number,
      approvalId: string,
    ): Promise<void> {
      await db
        .update(satelliteJobs)
        .set({ approvalId })
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.sequence, sequence),
          ),
        );
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Retires Jobs past their TTL. An outcome the
     * Agent has not been told about is kept regardless of age: deleting it would
     * drop the one turn it is owed, and the hourly wake retry is what eventually
     * clears it. Told about means woken, not merely claimed for delivery — a row
     * a delivery claimed and did not finish is exactly what the retry comes back
     * for. A running Job is never touched, since the machine still holds it.
     */
    async purgeExpired(now: Date): Promise<void> {
      await db
        .delete(satelliteJobs)
        .where(
          and(
            lt(satelliteJobs.expiresAt, now),
            ne(satelliteJobs.status, "running"),
            sql`${satelliteJobs.deliveredAt} is not null`,
            sql`${satelliteJobs.wokeAt} is not null`,
          ),
        );
    },
  };
}

export type SatellitesRepository = ReturnType<
  typeof createSatellitesRepository
>;
