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
import { resolveBinding } from "../domain/artifact-request-binding.js";
import { buildArtifactRequestPrompt } from "../domain/artifact-request-prompt.js";
import { generateId } from "../domain/share-crypto.js";
import type {
  ArtifactLibraryRepository,
  ArtifactRow,
} from "../infrastructure/artifact-library-repository.js";
import {
  ArtifactRequestCollisionError,
  ArtifactRequestPageGoneError,
  type ArtifactRequestRow,
  type ArtifactRequestsRepository,
} from "../infrastructure/artifact-requests-repository.js";
import type { ArtifactRequestDelivery } from "./artifact-request-delivery.js";

export type ArtifactRequestAnswerOutcome =
  | { ok: true; request: ArtifactRequest }
  | { ok: false; error: string };

export interface ArtifactRequestsServiceImpl extends ArtifactRequestsService {
  fail(
    requestId: string,
    reason: ArtifactRequestFailureReason,
  ): Promise<ArtifactRequest | null>;
  answer(input: {
    requestId: string;
    agentId: string;
    result: unknown;
  }): Promise<ArtifactRequestAnswerOutcome>;
}

export interface ArtifactRequestsDeps {
  requests: ArtifactRequestsRepository;
  library: ArtifactLibraryRepository;
  delivery: ArtifactRequestDelivery;
  readPageSource: (artifactId: string) => Promise<string | null>;
  owner: string;
  surface: string;
}

export function refusalMessage(reason: ArtifactRequestFailureReason): string {
  return match(reason)
    .with(
      "agent_deleted",
      () => "the agent that published this page is no longer there",
    )
    .with(
      "session_deleted",
      () => "the conversation this page asks in has been deleted",
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
  const { requests, library, delivery, readPageSource, owner, surface } = deps;

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

  async function pageSourceOrNothing(
    row: ArtifactRequestRow,
  ): Promise<string | null> {
    try {
      return await readPageSource(row.artifactId);
    } catch (error) {
      process.stderr.write(
        `[artifact-requests] source of ${row.artifactId} unreadable, asking without it: ${String(error)}\n`,
      );
      return null;
    }
  }

  async function bindingFor(
    row: ArtifactRequestRow,
    page: ArtifactRow,
    offered: string | null,
  ): Promise<
    | { ok: true; sessionId: string | null; pinning: boolean }
    | { ok: false; reason: ArtifactRequestFailureReason }
  > {
    const binding = resolveBinding(page, offered);
    const chosen = await match(binding)
      .with({ kind: "artifact-session" }, () =>
        Promise.resolve({ sessionId: null as string | null, pinning: false }),
      )
      .with({ kind: "bound" }, ({ sessionId: bound }) =>
        Promise.resolve({
          sessionId: bound as string | null,
          pinning: false,
        }),
      )
      .with({ kind: "pin" }, async ({ sessionId: offer }) => ({
        sessionId:
          (await library.pinSession(row.artifactId, owner, offer)) ?? offer,
        pinning: true,
      }))
      .exhaustive();
    if (chosen.sessionId === null)
      return { ok: true, sessionId: null, pinning: false };
    const reachable = await delivery.checkBinding({
      requestId: row.id,
      agentId: row.agentId,
      sessionId: chosen.sessionId,
    });
    if (!reachable.ok) return { ok: false, reason: reachable.reason };
    return { ok: true, sessionId: chosen.sessionId, pinning: chosen.pinning };
  }

  async function deliver(
    row: ArtifactRequestRow,
    page: ArtifactRow,
    offered: string | null,
  ): Promise<void> {
    const binding = await bindingFor(row, page, offered);
    process.stderr.write(
      `[artifact-requests] ${row.id} seq ${String(row.seq)} of ${row.artifactId}: ` +
        `offered ${offered ?? "no conversation"}, ` +
        `${binding.ok ? (binding.sessionId ?? "asking in the page's own Artifact Session") : `refused as ${binding.reason}`}\n`,
    );
    if (!binding.ok) {
      await settleAs(row.id, binding.reason);
      return;
    }
    const bound = binding.sessionId !== null;
    const source =
      !bound && row.seq === 1 ? await pageSourceOrNothing(row) : null;
    const task = buildArtifactRequestPrompt({
      requestId: row.id,
      artifactId: row.artifactId,
      title: page.title,
      seq: row.seq,
      action: row.action,
      payload: row.payload,
      trigger: row.trigger,
      bound,
      brief: bound && !binding.pinning ? null : page.brief,
      source,
    });
    const outcome = await delivery.deliver({
      requestId: row.id,
      artifactId: row.artifactId,
      agentId: row.agentId,
      sessionId: binding.sessionId,
      task,
    });
    if (outcome.ok) {
      await requests.markDelivered(row.id, owner);
      return;
    }
    await settleAs(row.id, outcome.reason);
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
        trigger: input.trigger,
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
          .with(
            { code: "no-self-refresh" },
            () =>
              new TRPCError({
                code: "PRECONDITION_FAILED",
                message:
                  "this page asks in the conversation it belongs to, so it only asks when a person does — a page that refreshes itself has to be published with own_session",
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
        void deliver(row, page, input.sessionId ?? null).catch(
          (error: unknown) => {
            process.stderr.write(
              `[artifact-requests] delivery of ${row.id} threw: ${String(error)}\n`,
            );
          },
        );
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

    async answer({ requestId, agentId, result }) {
      const row = await requests.get(requestId, owner);
      if (!row || row.agentId !== agentId) {
        return {
          ok: false,
          error: `no request ${requestId} belongs to this agent`,
        };
      }
      const answered = await requests.settle(requestId, owner, {
        state: "answered",
        result,
        settledAt: new Date(),
      });
      if (!answered) {
        return {
          ok: false,
          error: `request ${requestId} is already ${row.state}${
            row.failureReason ? ` (${row.failureReason})` : ""
          } and takes no answer`,
        };
      }
      announceSettled(answered);
      return { ok: true, request: toArtifactRequest(answered) };
    },

    fail: settleAs,
  };
}
