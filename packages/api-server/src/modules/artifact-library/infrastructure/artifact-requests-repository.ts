import type {
  ArtifactRequestFailureReason,
  ArtifactRequestState,
  ArtifactRequestTrigger,
} from "api-server-api";
import {
  and,
  eq,
  gte,
  inArray,
  lt,
  sql,
  type Db,
  artifactRequests as requestsTable,
  libraryArtifacts as artifactsTable,
} from "db";

import { isUniqueViolation } from "../../../core/db-errors.js";
import { ARTIFACT_REQUEST_IN_FLIGHT_STATES } from "../domain/artifact-request.js";

export interface ArtifactRequestRow {
  id: string;
  owner: string;
  artifactId: string;
  agentId: string;
  seq: number;
  action: string;
  payload: Record<string, unknown>;
  trigger: ArtifactRequestTrigger;
  state: ArtifactRequestState;
  result: unknown;
  failureReason: ArtifactRequestFailureReason | null;
  createdAt: Date;
  settledAt: Date | null;
}

export interface ArtifactRequestInsert {
  id: string;
  owner: string;
  artifactId: string;
  agentId: string;
  action: string;
  payload: Record<string, unknown>;
  trigger: ArtifactRequestTrigger;
}

export interface ArtifactRequestSettlement {
  state: "answered" | "failed";
  result?: unknown;
  failureReason?: ArtifactRequestFailureReason;
  settledAt: Date;
}

export class ArtifactRequestCollisionError extends Error {
  constructor(artifactId: string) {
    super(`another request for artifact ${artifactId} is already in flight`);
    this.name = "ArtifactRequestCollisionError";
  }
}

export class ArtifactRequestPageGoneError extends Error {
  constructor(artifactId: string) {
    super(`artifact ${artifactId} no longer exists`);
    this.name = "ArtifactRequestPageGoneError";
  }
}

export interface ArtifactRequestsRepository {
  insertNext(input: ArtifactRequestInsert): Promise<ArtifactRequestRow>;
  get(id: string, owner: string): Promise<ArtifactRequestRow | null>;
  findInFlight(
    artifactId: string,
    owner: string,
  ): Promise<ArtifactRequestRow | null>;
  countSince(artifactId: string, owner: string, since: Date): Promise<number>;
  markDelivered(id: string, owner: string): Promise<ArtifactRequestRow | null>;
  listStale(before: Date, limit: number): Promise<ArtifactRequestRow[]>;
  settle(
    id: string,
    owner: string,
    settlement: ArtifactRequestSettlement,
  ): Promise<ArtifactRequestRow | null>;
}

function toRow(r: typeof requestsTable.$inferSelect): ArtifactRequestRow {
  return {
    id: r.id,
    owner: r.owner,
    artifactId: r.artifactId,
    agentId: r.agentId,
    seq: r.seq,
    action: r.action,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    trigger: r.trigger as ArtifactRequestTrigger,
    state: r.state as ArtifactRequestState,
    result: r.result,
    failureReason: r.failureReason as ArtifactRequestFailureReason | null,
    createdAt: r.createdAt,
    settledAt: r.settledAt,
  };
}

export function createArtifactRequestsRepository(
  db: Db,
): ArtifactRequestsRepository {
  return {
    async insertNext(input) {
      try {
        return await db.transaction(async (tx) => {
          const [page] = await tx
            .select({ id: artifactsTable.id })
            .from(artifactsTable)
            .where(
              and(
                eq(artifactsTable.id, input.artifactId),
                eq(artifactsTable.owner, input.owner),
              ),
            )
            .for("update");
          if (!page) throw new ArtifactRequestPageGoneError(input.artifactId);
          const [high] = await tx
            .select({
              seq: sql<number>`coalesce(max(${requestsTable.seq}), 0)`,
            })
            .from(requestsTable)
            .where(eq(requestsTable.artifactId, input.artifactId));
          const [inserted] = await tx
            .insert(requestsTable)
            .values({
              id: input.id,
              owner: input.owner,
              artifactId: input.artifactId,
              agentId: input.agentId,
              seq: (high?.seq ?? 0) + 1,
              action: input.action,
              payload: input.payload,
              trigger: input.trigger,
              state: "pending",
            })
            .returning();
          return toRow(inserted!);
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ArtifactRequestCollisionError(input.artifactId);
        throw error;
      }
    },

    async get(id, owner) {
      const [row] = await db
        .select()
        .from(requestsTable)
        .where(and(eq(requestsTable.id, id), eq(requestsTable.owner, owner)))
        .limit(1);
      return row ? toRow(row) : null;
    },

    async findInFlight(artifactId, owner) {
      const [row] = await db
        .select()
        .from(requestsTable)
        .where(
          and(
            eq(requestsTable.artifactId, artifactId),
            eq(requestsTable.owner, owner),
            inArray(requestsTable.state, [
              ...ARTIFACT_REQUEST_IN_FLIGHT_STATES,
            ]),
          ),
        )
        .limit(1);
      return row ? toRow(row) : null;
    },

    async countSince(artifactId, owner, since) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(requestsTable)
        .where(
          and(
            eq(requestsTable.artifactId, artifactId),
            eq(requestsTable.owner, owner),
            gte(requestsTable.createdAt, since),
          ),
        );
      return row?.count ?? 0;
    },

    async markDelivered(id, owner) {
      const [row] = await db
        .update(requestsTable)
        .set({ state: "delivered" })
        .where(
          and(
            eq(requestsTable.id, id),
            eq(requestsTable.owner, owner),
            eq(requestsTable.state, "pending"),
          ),
        )
        .returning();
      return row ? toRow(row) : null;
    },

    async listStale(before, limit) {
      const rows = await db
        .select()
        .from(requestsTable)
        .where(
          and(
            lt(requestsTable.createdAt, before),
            inArray(requestsTable.state, [
              ...ARTIFACT_REQUEST_IN_FLIGHT_STATES,
            ]),
          ),
        )
        .orderBy(requestsTable.createdAt)
        .limit(limit);
      return rows.map(toRow);
    },

    async settle(id, owner, settlement) {
      const [row] = await db
        .update(requestsTable)
        .set({
          state: settlement.state,
          settledAt: settlement.settledAt,
          ...(settlement.result !== undefined
            ? { result: settlement.result }
            : {}),
          ...(settlement.failureReason !== undefined
            ? { failureReason: settlement.failureReason }
            : {}),
        })
        .where(
          and(
            eq(requestsTable.id, id),
            eq(requestsTable.owner, owner),
            inArray(requestsTable.state, [
              ...ARTIFACT_REQUEST_IN_FLIGHT_STATES,
            ]),
          ),
        )
        .returning();
      return row ? toRow(row) : null;
    },
  };
}
