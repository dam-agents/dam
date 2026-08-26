import { TRPCError } from "@trpc/server";
import type {
  ArtifactRequest,
  ArtifactRequestCreateInput,
  ArtifactRequestFailureReason,
  ArtifactRequestReceipt,
  ArtifactRequestsService,
} from "api-server-api";
import { match } from "ts-pattern";

import { emit, EventType } from "../../../events.js";
import { admitRequest, windowStart } from "../domain/artifact-request.js";
import { generateId } from "../domain/share-crypto.js";
import type { ArtifactLibraryRepository } from "../infrastructure/artifact-library-repository.js";
import {
  ArtifactRequestCollisionError,
  ArtifactRequestPageGoneError,
  type ArtifactRequestRow,
  type ArtifactRequestsRepository,
} from "../infrastructure/artifact-requests-repository.js";

export interface ArtifactRequestsServiceImpl extends ArtifactRequestsService {
  fail(
    requestId: string,
    reason: ArtifactRequestFailureReason,
  ): Promise<ArtifactRequest | null>;
}

export interface ArtifactRequestsDeps {
  requests: ArtifactRequestsRepository;
  library: ArtifactLibraryRepository;
  owner: string;
  surface: string;
}

export function refusalMessage(reason: ArtifactRequestFailureReason): string {
  return match(reason)
    .with(
      "agent_deleted",
      () => "the agent that published this page is no longer there",
    )
    .with("wake_failed", () => "the agent could not be woken")
    .with("over_budget", () => "there is no room to run the agent right now")
    .with(
      "rate_limited",
      () => "this page has asked its agent too many times in the last hour",
    )
    .with("busy", () => "this page is already waiting on an answer")
    .with("cancelled", () => "the request was cancelled")
    .with("expired", () => "the agent did not answer in time")
    .exhaustive();
}

export function artifactRequestRefusal(
  reason: ArtifactRequestFailureReason,
): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: refusalMessage(reason),
    cause: { artifactRequestRefusal: { reason } },
  });
}

export function toArtifactRequest(row: ArtifactRequestRow): ArtifactRequest {
  return {
    id: row.id,
    artifactId: row.artifactId,
    agentId: row.agentId,
    seq: row.seq,
    action: row.action,
    payload: row.payload,
    trigger: row.trigger,
    state: row.state,
    result: row.result,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}

export function createArtifactRequestsService(
  deps: ArtifactRequestsDeps,
): ArtifactRequestsServiceImpl {
  const { requests, library, owner, surface } = deps;

  function announceSettled(row: ArtifactRequestRow): void {
    emit({
      type: EventType.ArtifactRequestSettled,
      requestId: row.id,
      artifactId: row.artifactId,
      agentId: row.agentId,
      ownerSub: owner,
      seq: row.seq,
      action: row.action,
      state: row.state === "answered" ? "answered" : "failed",
      ...(row.failureReason ? { failureReason: row.failureReason } : {}),
      ...(row.trigger === "user" ? { actorSub: owner, surface } : {}),
    });
  }

  async function settleAs(
    requestId: string,
    reason: ArtifactRequestFailureReason,
  ): Promise<ArtifactRequest | null> {
    const settled = await requests.settle(requestId, owner, {
      state: "failed",
      failureReason: reason,
      settledAt: new Date(),
    });
    if (!settled) return null;
    announceSettled(settled);
    return toArtifactRequest(settled);
  }

  return {
    async create(input: ArtifactRequestCreateInput) {
      const page = await library.getArtifact(input.artifactId, owner);
      if (!page)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "artifact not found",
        });

      const now = new Date();
      const [inFlight, requestsInWindow] = await Promise.all([
        requests.findInFlight(input.artifactId, owner),
        requests.countSince(input.artifactId, owner, windowStart(now)),
      ]);

      const admitted = admitRequest(page, {
        inFlight: inFlight !== null,
        requestsInWindow,
      });
      if (!admitted.ok) {
        throw match(admitted.error)
          .with(
            { code: "not-interactive" },
            () =>
              new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "this artifact is not interactive, so it cannot ask its agent",
              }),
          )
          .with(
            { code: "shared" },
            () =>
              new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "a shared page cannot ask its agent",
              }),
          )
          .with({ code: "named" }, ({ reason }) =>
            artifactRequestRefusal(reason),
          )
          .exhaustive();
      }

      try {
        const row = await requests.insertNext({
          id: generateId(),
          owner,
          artifactId: input.artifactId,
          agentId: admitted.value.agentId,
          action: input.action,
          payload: input.payload ?? {},
          trigger: input.trigger,
        });
        return {
          requestId: row.id,
          seq: row.seq,
          state: row.state,
        } satisfies ArtifactRequestReceipt;
      } catch (error) {
        if (error instanceof ArtifactRequestCollisionError)
          throw artifactRequestRefusal("busy");
        if (error instanceof ArtifactRequestPageGoneError)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "artifact not found",
          });
        throw error;
      }
    },

    async get(requestId) {
      const row = await requests.get(requestId, owner);
      return row ? toArtifactRequest(row) : null;
    },

    async cancel(requestId) {
      const cancelled = await settleAs(requestId, "cancelled");
      if (cancelled) return cancelled;
      const row = await requests.get(requestId, owner);
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "request not found",
        });
      return toArtifactRequest(row);
    },

    fail: settleAs,
  };
}
