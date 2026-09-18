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
  SatelliteCommand,
  SatelliteManifest,
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
    commands: r.commands as SatelliteCommand[],
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
    cmd: r.cmd as string[],
    pattern: r.pattern,
    status: r.status as JobStatus,
    approvalId: r.approvalId,
    exitCode: r.exitCode,
    output: r.output,
    truncated: r.truncated,
    reason: r.reason,
    cancelRequested: r.cancelRequested,
    cancelSentAt: r.cancelSentAt,
    deliveredAt: r.deliveredAt,
    wokeAt: r.wokeAt,
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
          commands: manifest.commands,
          draining: false,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [satellites.owner, satellites.name],
          set: {
            description: manifest.description ?? null,
            host,
            maxConcurrent,
            commands: manifest.commands,
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
      cmd: string[];
      pattern: string;
      status: JobStatus;
      expiresAt: Date;
      maxConcurrent: number;
      patternMax: number | null;
    }): Promise<JobRow | { full: true; total: number; forPattern: number }> {
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
            pattern: satelliteJobs.pattern,
          })
          .from(satelliteJobs)
          .where(
            and(
              eq(satelliteJobs.owner, input.owner),
              eq(satelliteJobs.satellite, input.satellite),
              notInArray(satelliteJobs.status, [...TERMINAL_STATUSES]),
            ),
          );
        const forPattern = live.filter(
          (row) => row.pattern === input.pattern,
        ).length;
        if (
          live.length >= input.maxConcurrent ||
          (input.patternMax !== null && forPattern >= input.patternMax)
        )
          return { full: true as const, total: live.length, forPattern };

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
        const { maxConcurrent, patternMax, ...values } = input;
        void maxConcurrent;
        void patternMax;
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
     * UNIT_BOUNDARY_DESCRIPTION: Takes the cancellations waiting for this
     * Satellite, clearing the flag as it hands them over. The flag is a request
     * rather than a state, so leaving it set would re-send the same work item on
     * every poll — and a poll that always answers non-empty never rests. A
     * cancellation the worker then ignores is bounded anyway: the Job either
     * finishes or its lease expires.
     */
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
        exitCode?: number | null;
        output?: string | null;
        truncated?: boolean;
        reason?: string | null;
      },
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
        .set({ status: "queued" })
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.sequence, sequence),
            eq(satelliteJobs.status, "pending-approval"),
          ),
        );
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

    async markDelivered(
      owner: string,
      satellite: string,
      sequence: number,
    ): Promise<boolean> {
      const rows = await db
        .update(satelliteJobs)
        .set({ deliveredAt: new Date() })
        .where(
          and(
            eq(satelliteJobs.owner, owner),
            eq(satelliteJobs.satellite, satellite),
            eq(satelliteJobs.sequence, sequence),
            sql`${satelliteJobs.deliveredAt} is null`,
          ),
        )
        .returning({ sequence: satelliteJobs.sequence });
      return rows.length > 0;
    },

    async claimUndeliveredOutcomes(agentId: string): Promise<JobRow[]> {
      const rows = await db
        .update(satelliteJobs)
        .set({ deliveredAt: new Date() })
        .where(
          and(
            eq(satelliteJobs.agentId, agentId),
            inArray(satelliteJobs.status, [...TERMINAL_STATUSES]),
            sql`${satelliteJobs.deliveredAt} is null`,
          ),
        )
        .returning();
      return rows.map(toJob);
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

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Jobs past their TTL that never reached a
     * machine — queued with nobody claiming, or held for an approval whose row
     * is gone. They are settled rather than deleted: each still holds a place
     * against the Satellite's concurrency, and the Agent that started it is owed
     * an answer.
     */
    async staleUnstarted(now: Date): Promise<JobRow[]> {
      const rows = await db
        .select()
        .from(satelliteJobs)
        .where(
          and(
            lt(satelliteJobs.expiresAt, now),
            notInArray(satelliteJobs.status, [...TERMINAL_STATUSES, "running"]),
          ),
        );
      return rows.map(toJob);
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
      await db
        .update(satelliteJobs)
        .set({ status: "cancelled", endedAt: new Date(), leaseUntil: null })
        .where(
          and(
            eq(satelliteJobs.agentId, agentId),
            inArray(satelliteJobs.status, ["queued", "pending-approval"]),
          ),
        );
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Retires Jobs past their TTL. An outcome the
     * Agent has not been told about is kept regardless of age: deleting it would
     * drop the one turn it is owed, and the hourly wake retry is what eventually
     * clears it. A running Job is never touched, since the machine still holds
     * it.
     */
    async purgeExpired(now: Date): Promise<void> {
      await db
        .delete(satelliteJobs)
        .where(
          and(
            lt(satelliteJobs.expiresAt, now),
            ne(satelliteJobs.status, "running"),
            sql`${satelliteJobs.deliveredAt} is not null`,
          ),
        );
    },
  };
}

export type SatellitesRepository = ReturnType<
  typeof createSatellitesRepository
>;
