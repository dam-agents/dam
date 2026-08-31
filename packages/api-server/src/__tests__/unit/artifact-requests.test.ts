import { describe, expect, it } from "vitest";

import { emit, events$, EventType, type DomainEvent } from "../../events.js";
import { hintFor } from "../../modules/live-events/sagas/live-hints.js";
import {
  admitRequest,
  ARTIFACT_REQUEST_HOURLY_CAP,
  isInFlight,
  windowStart,
} from "../../modules/artifact-library/domain/artifact-request.js";
import type { ArtifactLibraryRepository } from "../../modules/artifact-library/infrastructure/artifact-library-repository.js";
import {
  ArtifactRequestCollisionError,
  type ArtifactRequestRow,
  type ArtifactRequestsRepository,
} from "../../modules/artifact-library/infrastructure/artifact-requests-repository.js";
import { createArtifactRequestsService } from "../../modules/artifact-library/services/artifact-requests-service.js";
import type {
  ArtifactRequestDelivery,
  ArtifactRequestDeliveryInput,
} from "../../modules/artifact-library/services/artifact-request-delivery.js";
import { createArtifactRequestExpirySweeper } from "../../modules/artifact-library/services/request-expiry-sweeper.js";
import { ARTIFACT_REQUEST_TTL_MS } from "../../modules/artifact-library/domain/artifact-request.js";
import type { ActivityEventRow } from "../../modules/usage/domain/types.js";
import { startPersistActivitySaga } from "../../modules/usage/sagas/persist-activity.js";

// TEST_OVERVIEW: An Artifact Request is one thing an interactive page asked its agent to do — a button clicked, a choice made in a dropdown, a form submitted. `action` names what was asked. The owner may only ask through a page that is interactive, private, and theirs, and the page must have an agent to ask. Requests are numbered per artifact, at most one is in flight at a time (a second gets `busy`, never a queue), and no more than 60 land in a rolling hour (past that, `rate_limited`). Every settle raises a live event so the app refetches, and a settle the service makes carries the owner as its actor into the activity log; only the expiry sweep has no actor. Once the row is committed the request is carried to the agent: an outbox event plus a wake, marked `delivered` when the agent is up, or settled with the reason the wake gave — `agent_deleted`, `over_budget`, `wake_failed`. The agent settles it by calling `answer_artifact_request`, which only takes an answer for its own request and only once. A request nobody answered before its TTL is swept as `expired` so the page is not stuck waiting. Where the turn lands is settled by the first ask that carries a conversation: the app sends the one it has open behind the page, that ask pins it, and every later ask uses the pinned one wherever the page was opened from. An ask on an unbound page that offers no conversation is refused `not_bound` before any row is written — there is no other place a page can live. A bound page whose conversation the owner deleted settles `session_deleted` with nothing left in the outbox.

type PageOverrides = Partial<{
  id: string;
  owner: string;
  agentId: string | null;
  interactive: boolean;
  visibility: string;
  sessionId: string | null;
}>;

function page(overrides: PageOverrides = {}) {
  return {
    id: "art-1",
    owner: "o1",
    agentId: "agent-1",
    interactive: true,
    visibility: "private",
    sessionId: null as string | null,
    title: "Weather board",
    ...overrides,
  };
}

function fakeLibrary(
  pages: ReturnType<typeof page>[],
): ArtifactLibraryRepository {
  const getArtifact = (id: string, owner: string) =>
    Promise.resolve(
      pages.find((p) => p.id === id && p.owner === owner) ?? null,
    );
  const pinSession = (id: string, owner: string, sessionId: string) => {
    const found = pages.find((p) => p.id === id && p.owner === owner);
    if (!found) return Promise.resolve(null);
    found.sessionId ??= sessionId;
    return Promise.resolve(found.sessionId);
  };
  return { getArtifact, pinSession } as unknown as ArtifactLibraryRepository;
}

function fakeRequests(rows: ArtifactRequestRow[]): ArtifactRequestsRepository {
  return {
    insertNext: (input) => {
      if (
        rows.some(
          (r) => r.artifactId === input.artifactId && isInFlight(r.state),
        )
      ) {
        return Promise.reject(
          new ArtifactRequestCollisionError(input.artifactId),
        );
      }
      const seq =
        rows
          .filter((r) => r.artifactId === input.artifactId)
          .reduce((high, r) => Math.max(high, r.seq), 0) + 1;
      const row: ArtifactRequestRow = {
        ...input,
        seq,
        state: "pending",
        result: null,
        failureReason: null,
        createdAt: new Date(),
        settledAt: null,
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    get: (id, owner) =>
      Promise.resolve(
        rows.find((r) => r.id === id && r.owner === owner) ?? null,
      ),
    findInFlight: (artifactId, owner) =>
      Promise.resolve(
        rows.find(
          (r) =>
            r.artifactId === artifactId &&
            r.owner === owner &&
            isInFlight(r.state),
        ) ?? null,
      ),
    countSince: (artifactId, owner, since) =>
      Promise.resolve(
        rows.filter(
          (r) =>
            r.artifactId === artifactId &&
            r.owner === owner &&
            r.createdAt >= since,
        ).length,
      ),
    markDelivered: (id, owner) => {
      const row = rows.find(
        (r) => r.id === id && r.owner === owner && r.state === "pending",
      );
      if (!row) return Promise.resolve(null);
      row.state = "delivered";
      return Promise.resolve(row);
    },
    listStale: (before, limit) =>
      Promise.resolve(
        rows
          .filter((r) => isInFlight(r.state) && r.createdAt < before)
          .slice(0, limit),
      ),
    settle: (id, owner, settlement) => {
      const row = rows.find(
        (r) => r.id === id && r.owner === owner && isInFlight(r.state),
      );
      if (!row) return Promise.resolve(null);
      row.state = settlement.state;
      row.settledAt = settlement.settledAt;
      if (settlement.result !== undefined) row.result = settlement.result;
      if (settlement.failureReason !== undefined)
        row.failureReason = settlement.failureReason;
      return Promise.resolve(row);
    },
  };
}

function fakeDelivery(
  outcome: Awaited<ReturnType<ArtifactRequestDelivery["deliver"]>> = {
    ok: true,
  },
  binding: Awaited<ReturnType<ArtifactRequestDelivery["checkBinding"]>> = {
    ok: true,
  },
): ArtifactRequestDelivery & {
  calls: ArtifactRequestDeliveryInput[];
  checked: string[];
} {
  const calls: ArtifactRequestDeliveryInput[] = [];
  const checked: string[] = [];
  return {
    calls,
    checked,
    checkBinding: ({ sessionId }) => {
      checked.push(sessionId);
      return Promise.resolve(binding);
    },
    deliver: (input) => {
      calls.push(input);
      return Promise.resolve(outcome);
    },
  };
}

async function settleBackgroundWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function serviceOver(
  pages: ReturnType<typeof page>[],
  rows: ArtifactRequestRow[] = [],
  owner = "o1",
  overrides: {
    delivery?: ArtifactRequestDelivery;
  } = {},
) {
  return createArtifactRequestsService({
    requests: fakeRequests(rows),
    library: fakeLibrary(pages),
    delivery: overrides.delivery ?? fakeDelivery(),
    owner,
    surface: "ui",
  });
}

function settledRow(
  overrides: Partial<ArtifactRequestRow>,
): ArtifactRequestRow {
  return {
    id: "req-old",
    owner: "o1",
    artifactId: "art-1",
    agentId: "agent-1",
    seq: 1,
    action: "refresh",
    payload: {},
    state: "answered",
    result: { now: "then" },
    failureReason: null,
    createdAt: new Date(),
    settledAt: new Date(),
    ...overrides,
  };
}

function collect(): { seen: DomainEvent[]; stop: () => void } {
  const seen: DomainEvent[] = [];
  const sub = events$().subscribe((event) => seen.push(event));
  return { seen, stop: () => sub.unsubscribe() };
}

describe("admitting a request", () => {
  const load = {
    inFlight: false,
    requestsInWindow: 0,
  };

  // TEST_SCENARIO: A plain artifact has no bridge to its agent, so asking through it is a caller mistake rather than a temporary failure.
  it("refuses a page that was not published interactive", () => {
    const refusal = admitRequest(page({ interactive: false }), load);
    expect(refusal).toEqual({
      ok: false,
      error: { code: "not-interactive" },
    });
  });

  // TEST_SCENARIO: An agent runs with its owner's credentials, so a page anyone could open must never drive it. Sharing is refused at create, but this path checks it again rather than trusting that.
  it("refuses a page that is public", () => {
    expect(admitRequest(page({ visibility: "public" }), load)).toEqual({
      ok: false,
      error: { code: "shared" },
    });
  });

  // TEST_SCENARIO: A page uploaded by hand has no agent to ask. The page renders the same copy as for an agent that was deleted, so the reason is the same.
  it("refuses a page with no agent behind it", () => {
    expect(admitRequest(page({ agentId: null }), load)).toEqual({
      ok: false,
      error: { code: "named", reason: "agent_deleted" },
    });
  });

  // TEST_SCENARIO: Serving a request is a whole agent turn. A second one while the first is unanswered is refused outright — queueing them would let a page stack up turns the owner pays for.
  it("refuses a second request while one is in flight", () => {
    expect(admitRequest(page(), { ...load, inFlight: true })).toEqual({
      ok: false,
      error: { code: "named", reason: "busy" },
    });
  });

  // TEST_SCENARIO: The rolling-hour cap bounds what one page can spend. The 60th request still lands; the 61st does not.
  it("admits up to the hourly cap and refuses past it", () => {
    expect(
      admitRequest(page(), {
        ...load,
        requestsInWindow: ARTIFACT_REQUEST_HOURLY_CAP - 1,
      }),
    ).toEqual({ ok: true, value: { agentId: "agent-1" } });
    expect(
      admitRequest(page(), {
        ...load,
        requestsInWindow: ARTIFACT_REQUEST_HOURLY_CAP,
      }),
    ).toEqual({ ok: false, error: { code: "named", reason: "rate_limited" } });
  });

  // TEST_SCENARIO: The window is the last hour counted back from now, so requests older than that stop counting against the cap.
  it("counts the cap over the hour before now", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    expect(windowStart(now).toISOString()).toBe("2026-08-26T11:00:00.000Z");
  });
});

describe("creating a request", () => {
  // TEST_SCENARIO: The first request of a page. The receipt comes back as soon as the row is committed — it never waits for the agent's turn.
  it("mints seq 1 and returns a pending receipt", async () => {
    const service = serviceOver([page()]);
    await expect(
      service.create({
        artifactId: "art-1",
        action: "refresh",
        sessionId: "sess-7",
      }),
    ).resolves.toMatchObject({ seq: 1, state: "pending" });
  });

  // TEST_SCENARIO: seq numbers the requests of one page in order, so a page can tell which answer belongs to which request.
  it("numbers each request of the same page in turn", async () => {
    const rows: ArtifactRequestRow[] = [];
    const service = serviceOver([page({ sessionId: "sess-7" })], rows);
    const first = await service.create({
      artifactId: "art-1",
      action: "refresh",
    });
    await service.cancel(first.requestId);
    await expect(
      service.create({
        artifactId: "art-1",
        action: "refresh",
      }),
    ).resolves.toMatchObject({ seq: 2 });
  });

  // TEST_SCENARIO: Another owner's page is not visible at all — the refusal must not tell the caller the id exists.
  it("reads another owner's page as not found", async () => {
    const service = serviceOver([page({ owner: "o1" })], [], "intruder");
    await expect(
      service.create({
        artifactId: "art-1",
        action: "refresh",
        sessionId: "sess-7",
      }),
    ).rejects.toThrow(/artifact not found/);
  });

  // TEST_SCENARIO: The three refusals a caller can act on differently: a mistake, a page that must stay unshared, and a temporary state.
  it("gives a non-interactive page, a shared page and a busy page distinct errors", async () => {
    const plain = serviceOver([page({ interactive: false })]);
    await expect(
      plain.create({ artifactId: "art-1", action: "a", sessionId: "sess-7" }),
    ).rejects.toThrow(/not interactive/);

    const shared = serviceOver([page({ visibility: "public" })]);
    await expect(
      shared.create({ artifactId: "art-1", action: "a", sessionId: "sess-7" }),
    ).rejects.toThrow(/shared page cannot ask/);

    const busy = serviceOver([page()]);
    await busy.create({ artifactId: "art-1", action: "a", sessionId: "s-1" });
    await expect(
      busy.create({ artifactId: "art-1", action: "a", sessionId: "s-1" }),
    ).rejects.toThrow(/already waiting on an answer/);
  });

  // TEST_SCENARIO: The page renders its own copy per reason, so the refusal must carry a machine-readable reason and not just a sentence.
  it("carries the named reason on the error cause", async () => {
    const service = serviceOver([page()]);
    await service.create({
      artifactId: "art-1",
      action: "a",
      sessionId: "sess-7",
    });
    const error = await service
      .create({ artifactId: "art-1", action: "a", sessionId: "sess-7" })
      .catch((e: unknown) => e);
    expect(
      (error as { cause: { artifactRequestRefusal: unknown } }).cause
        .artifactRequestRefusal,
    ).toEqual({ reason: "busy" });
  });

  // TEST_SCENARIO: The 61st request in an hour is refused even though nothing is in flight, and the reason says why.
  it("refuses past the hourly cap", async () => {
    const rows: ArtifactRequestRow[] = Array.from(
      { length: ARTIFACT_REQUEST_HOURLY_CAP },
      (_unused, i) =>
        settledRow({ id: `req-${i}`, seq: i + 1, state: "answered" }),
    );
    const service = serviceOver([page()], rows);
    const error = await service
      .create({ artifactId: "art-1", action: "a", sessionId: "sess-7" })
      .catch((e: unknown) => e);
    expect(
      (error as { cause: { artifactRequestRefusal: unknown } }).cause
        .artifactRequestRefusal,
    ).toEqual({ reason: "rate_limited" });
  });

  // TEST_SCENARIO: Requests older than the window have been spent already and must not hold the page back.
  it("lets a page ask again once the hour has rolled past", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    const rows: ArtifactRequestRow[] = Array.from(
      { length: ARTIFACT_REQUEST_HOURLY_CAP },
      (_unused, i) =>
        settledRow({
          id: `req-${i}`,
          seq: i + 1,
          state: "answered",
          createdAt: twoHoursAgo,
        }),
    );
    const service = serviceOver([page()], rows);
    await expect(
      service.create({ artifactId: "art-1", action: "a", sessionId: "s-1" }),
    ).resolves.toMatchObject({ seq: ARTIFACT_REQUEST_HOURLY_CAP + 1 });
  });

  // TEST_SCENARIO: The database enforces one-in-flight per page, so a request that loses the race is reported as busy rather than as a server fault.
  it("reports a lost race as busy", async () => {
    const rows: ArtifactRequestRow[] = [];
    const service = createArtifactRequestsService({
      requests: {
        ...fakeRequests(rows),
        findInFlight: () => Promise.resolve(null),
      },
      library: fakeLibrary([page()]),
      delivery: fakeDelivery(),
      owner: "o1",
      surface: "ui",
    });
    await service.create({ artifactId: "art-1", action: "a", sessionId: "s" });
    await expect(
      service.create({ artifactId: "art-1", action: "a", sessionId: "s" }),
    ).rejects.toThrow(/already waiting on an answer/);
  });
});

describe("carrying a request to the agent", () => {
  // TEST_SCENARIO: The receipt is not the delivery. Once the row is committed the request is carried to the agent as an outbox event plus a wake, and the row says `delivered` only after the agent is up.
  it("delivers the prompt and marks the row delivered", async () => {
    const rows: ArtifactRequestRow[] = [];
    const delivery = fakeDelivery();
    const service = serviceOver([page()], rows, "o1", { delivery });

    const receipt = await service.create({
      artifactId: "art-1",
      action: "refresh",
      payload: { city: "Prague" },
      sessionId: "sess-7",
    });
    expect(receipt.state).toBe("pending");
    await settleBackgroundWork();

    expect(delivery.calls).toHaveLength(1);
    expect(delivery.calls[0]).toMatchObject({
      requestId: receipt.requestId,
      artifactId: "art-1",
      agentId: "agent-1",
    });
    expect(delivery.calls[0]!.task).toContain("refresh");
    expect(delivery.calls[0]!.task).toContain(receipt.requestId);
    expect(rows[0]!.state).toBe("delivered");
  });

  // TEST_SCENARIO: An agent that is gone, one the owner has no room to start, and a wake that just gave up are three different things to the person looking at the page, so each settles under its own reason.
  it("settles with the reason the wake gave", async () => {
    for (const reason of [
      "agent_deleted",
      "over_budget",
      "wake_failed",
    ] as const) {
      const rows: ArtifactRequestRow[] = [];
      const service = serviceOver([page()], rows, "o1", {
        delivery: fakeDelivery({ ok: false, reason }),
      });
      const { requestId } = await service.create({
        artifactId: "art-1",
        action: "refresh",
        sessionId: "sess-7",
      });
      await settleBackgroundWork();
      await expect(service.get(requestId)).resolves.toMatchObject({
        state: "failed",
        failureReason: reason,
      });
    }
  });

  // TEST_SCENARIO: A failed delivery must free the page: the settle raises the live event so the waiting page hears the reason instead of timing out.
  it("raises the live event when delivery fails", async () => {
    const service = serviceOver([page()], [], "o1", {
      delivery: fakeDelivery({ ok: false, reason: "over_budget" }),
    });
    const { seen, stop } = collect();
    await service.create({
      artifactId: "art-1",
      action: "refresh",
      sessionId: "sess-7",
    });
    await settleBackgroundWork();
    stop();

    expect(seen).toMatchObject([
      {
        type: EventType.ArtifactRequestSettled,
        state: "failed",
        failureReason: "over_budget",
      },
    ]);
  });
});

describe("where a page asks", () => {
  // TEST_SCENARIO: The page's first ask carries the conversation the app has open behind it, and that write is what binds the page. The turn has to land there.
  it("pins the open conversation on the first ask", async () => {
    const pages = [page()];
    const delivery = fakeDelivery();
    const service = serviceOver(pages, [], "o1", { delivery });

    await service.create({
      artifactId: "art-1",
      action: "refresh",
      sessionId: "sess-7",
    });
    await settleBackgroundWork();

    expect(pages[0]!.sessionId).toBe("sess-7");
    expect(delivery.calls[0]!.sessionId).toBe("sess-7");
  });

  // TEST_SCENARIO: The binding is for the page's whole life. Opening the page from the Artifacts destination, or from another chat, must not move where it asks.
  it("keeps the pinned conversation whatever the later ask says", async () => {
    const pages = [page({ sessionId: "sess-7" })];
    const delivery = fakeDelivery();
    const rows: ArtifactRequestRow[] = [];
    const service = serviceOver(pages, rows, "o1", { delivery });

    const first = await service.create({
      artifactId: "art-1",
      action: "refresh",
      sessionId: "sess-99",
    });
    await settleBackgroundWork();
    await service.cancel(first.requestId);
    await service.create({
      artifactId: "art-1",
      action: "refresh",
    });
    await settleBackgroundWork();

    expect(pages[0]!.sessionId).toBe("sess-7");
    expect(delivery.calls.map((c) => c.sessionId)).toEqual([
      "sess-7",
      "sess-7",
    ]);
  });

  // TEST_SCENARIO: A page first used from the Artifacts destination has no conversation to belong to and nowhere else to ask. The refusal happens before any row is written, so nothing is in flight and no session of any kind is created.
  it("refuses not_bound when no conversation is open and none is pinned", async () => {
    const pages = [page()];
    const delivery = fakeDelivery();
    const rows: ArtifactRequestRow[] = [];
    const service = serviceOver(pages, rows, "o1", { delivery });

    const error = await service
      .create({ artifactId: "art-1", action: "refresh" })
      .catch((e: unknown) => e);

    expect(
      (error as { cause: { artifactRequestRefusal: unknown } }).cause
        .artifactRequestRefusal,
    ).toEqual({ reason: "not_bound" });
    expect(pages[0]!.sessionId).toBeNull();
    expect(rows).toEqual([]);
    expect(delivery.calls).toEqual([]);
    expect(delivery.checked).toEqual([]);
  });

  // TEST_SCENARIO: Pinning is not limited to the page's very first ask. A page whose first ask was refused not_bound would be stuck for life if only the first ask could bind — where a page asks would then depend on where it happened to be opened first.
  it("binds a page whose earlier asks carried no conversation", async () => {
    const pages = [page()];
    const delivery = fakeDelivery();
    const rows: ArtifactRequestRow[] = [];
    const service = serviceOver(pages, rows, "o1", { delivery });

    await service
      .create({ artifactId: "art-1", action: "refresh" })
      .catch(() => undefined);
    await service.create({
      artifactId: "art-1",
      action: "refresh",
      sessionId: "sess-7",
    });
    await settleBackgroundWork();

    expect(pages[0]!.sessionId).toBe("sess-7");
    expect(delivery.calls.map((c) => c.sessionId)).toEqual(["sess-7"]);
  });

  // TEST_SCENARIO: Deleting a conversation writes a tombstone the pod hides from its session list and nothing else, so a bound page would otherwise go on driving a conversation the person believes they deleted. The request settles under its own reason and nothing is left queued.
  it("settles session_deleted when the bound conversation is gone", async () => {
    const delivery = fakeDelivery(
      { ok: true },
      { ok: false, reason: "session_deleted" },
    );
    const service = serviceOver([page({ sessionId: "sess-7" })], [], "o1", {
      delivery,
    });

    const { requestId } = await service.create({
      artifactId: "art-1",
      action: "refresh",
    });
    await settleBackgroundWork();

    expect(delivery.checked).toEqual(["sess-7"]);
    expect(delivery.calls).toEqual([]);
    await expect(service.get(requestId)).resolves.toMatchObject({
      state: "failed",
      failureReason: "session_deleted",
    });
  });
});

describe("answering a request", () => {
  // TEST_SCENARIO: The answer is the whole point: the agent's result is stored on the row and the live event tells the waiting page to read it.
  it("stores the result and raises the live event", async () => {
    const rows = [
      settledRow({ id: "req-1", state: "delivered", settledAt: null }),
    ];
    const service = serviceOver([page()], rows);

    const { seen, stop } = collect();
    const outcome = await service.answer({
      requestId: "req-1",
      agentId: "agent-1",
      result: { temperature: 21 },
    });
    stop();

    expect(outcome).toMatchObject({
      ok: true,
      request: { state: "answered", result: { temperature: 21 } },
    });
    expect(seen).toMatchObject([
      { type: EventType.ArtifactRequestSettled, state: "answered" },
    ]);
  });

  // TEST_SCENARIO: Attribution is the agent's own identity. One agent answering another's request would let a page be driven by an agent it never published from.
  it("refuses a request that belongs to another agent", async () => {
    const rows = [
      settledRow({ id: "req-1", state: "delivered", settledAt: null }),
    ];
    const service = serviceOver([page()], rows);
    await expect(
      service.answer({
        requestId: "req-1",
        agentId: "agent-2",
        result: { ok: true },
      }),
    ).resolves.toEqual({
      ok: false,
      error: "no request req-1 belongs to this agent",
    });
    expect(rows[0]!.state).toBe("delivered");
  });

  // TEST_SCENARIO: A request takes exactly one answer. A second call, or an answer to a request the owner already cancelled, must say which state refused it so the agent stops retrying.
  it("refuses a request that has already settled", async () => {
    const rows = [
      settledRow({ id: "req-answered", state: "answered" }),
      settledRow({
        id: "req-cancelled",
        state: "failed",
        failureReason: "cancelled",
      }),
    ];
    const service = serviceOver([page()], rows);

    await expect(
      service.answer({
        requestId: "req-answered",
        agentId: "agent-1",
        result: {},
      }),
    ).resolves.toMatchObject({ ok: false, error: /already answered/ });
    await expect(
      service.answer({
        requestId: "req-cancelled",
        agentId: "agent-1",
        result: {},
      }),
    ).resolves.toMatchObject({ ok: false, error: /cancelled/ });
  });

  // TEST_SCENARIO: An unknown id reads the same as another agent's request — the tool must not confirm that some other agent's request exists.
  it("refuses an unknown request", async () => {
    const service = serviceOver([page()], []);
    await expect(
      service.answer({ requestId: "nope", agentId: "agent-1", result: {} }),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("expiring a request nobody answered", () => {
  // TEST_SCENARIO: One request in flight blocks the page from asking again. If an agent never answers, the sweep must settle the request as `expired` — otherwise the page stays busy forever.
  it("settles requests older than the TTL and leaves fresh ones alone", async () => {
    const rows = [
      settledRow({
        id: "req-stale",
        state: "delivered",
        settledAt: null,
        createdAt: new Date(Date.now() - ARTIFACT_REQUEST_TTL_MS - 1_000),
      }),
      settledRow({
        id: "req-fresh",
        state: "pending",
        settledAt: null,
        createdAt: new Date(),
      }),
    ];
    const sweeper = createArtifactRequestExpirySweeper({
      requests: fakeRequests(rows),
      batchSize: 50,
    });

    const { seen, stop } = collect();
    await expect(sweeper.tick()).resolves.toBe(1);
    stop();

    expect(rows[0]).toMatchObject({
      state: "failed",
      failureReason: "expired",
    });
    expect(rows[1]!.state).toBe("pending");
    expect(seen).toMatchObject([
      {
        type: EventType.ArtifactRequestSettled,
        requestId: "req-stale",
        state: "failed",
        failureReason: "expired",
      },
    ]);
  });

  // TEST_SCENARIO: The sweep runs on a timer for every owner, so it has no actor. An expiry must not be logged as something a person did.
  it("names no actor on an expiry", async () => {
    const rows = [
      settledRow({
        id: "req-stale",
        state: "pending",
        settledAt: null,
        createdAt: new Date(Date.now() - ARTIFACT_REQUEST_TTL_MS - 1_000),
      }),
    ];
    const sweeper = createArtifactRequestExpirySweeper({
      requests: fakeRequests(rows),
      batchSize: 50,
    });

    const { seen, stop } = collect();
    await sweeper.tick();
    stop();

    expect(seen[0]).not.toHaveProperty("actorSub");
  });
});

describe("settling a request", () => {
  // TEST_SCENARIO: Cancel is the owner's "stop listening". It settles the row and raises the live event so every open tab refetches; it does not stop the agent.
  it("cancel settles the row and raises the live event", async () => {
    const rows: ArtifactRequestRow[] = [];
    const service = serviceOver([page()], rows);
    const { requestId } = await service.create({
      artifactId: "art-1",
      action: "refresh",
      sessionId: "sess-7",
    });

    const { seen, stop } = collect();
    const cancelled = await service.cancel(requestId);
    stop();

    expect(cancelled).toMatchObject({
      state: "failed",
      failureReason: "cancelled",
    });
    expect(cancelled.settledAt).not.toBeNull();
    expect(seen).toEqual([
      {
        type: EventType.ArtifactRequestSettled,
        requestId,
        artifactId: "art-1",
        agentId: "agent-1",
        ownerSub: "o1",
        seq: 1,
        action: "refresh",
        state: "failed",
        failureReason: "cancelled",
        actorSub: "o1",
        surface: "ui",
      },
    ]);
  });

  // TEST_SCENARIO: Cancelling twice, or cancelling an answer that already landed, must not settle again or raise a second event — the caller just reads the state it has.
  it("cancel is a no-op once the request has settled", async () => {
    const rows = [settledRow({ id: "req-1", state: "answered" })];
    const service = serviceOver([page()], rows);

    const { seen, stop } = collect();
    await expect(service.cancel("req-1")).resolves.toMatchObject({
      state: "answered",
    });
    stop();
    expect(seen).toEqual([]);
  });

  // TEST_SCENARIO: `fail` is how the delivery path settles a request nobody can serve. It answers null when the row is already settled, so a late failure cannot overwrite an answer.
  it("fail settles a pending request and declines a settled one", async () => {
    const rows = [
      settledRow({ id: "req-live", state: "pending", settledAt: null }),
      settledRow({ id: "req-done", state: "answered" }),
    ];
    const service = serviceOver([page()], rows);

    await expect(
      service.fail("req-live", "wake_failed"),
    ).resolves.toMatchObject({ state: "failed", failureReason: "wake_failed" });
    await expect(service.fail("req-done", "expired")).resolves.toBeNull();
    expect(rows[1]!.result).toEqual({ now: "then" });
  });

  // TEST_SCENARIO: Cancelling a request that does not exist, or belongs to someone else, must not report a state.
  it("cancel refuses an unknown request", async () => {
    const service = serviceOver([page()], []);
    await expect(service.cancel("nope")).rejects.toThrow(/request not found/);
  });
});

describe("what a settle reaches", () => {
  // TEST_SCENARIO: The app keeps one owner stream. A settle has to name the request so a page waiting on that one can react, not just the artifact.
  it("projects a live hint naming the request and its state", () => {
    expect(
      hintFor({
        type: EventType.ArtifactRequestSettled,
        requestId: "req-1",
        artifactId: "art-1",
        agentId: "agent-1",
        ownerSub: "o1",
        seq: 3,
        action: "refresh",
        state: "answered",
        actorSub: "o1",
        surface: "ui",
      }),
    ).toEqual({
      ownerSub: "o1",
      hint: {
        topic: "artifactRequest",
        requestId: "req-1",
        artifactId: "art-1",
        state: "answered",
      },
    });
  });

  // TEST_SCENARIO: A settled request is product usage and belongs in the activity log, with the outcome of the turn it paid for.
  it("records a settled request under its actor", async () => {
    const inserted: ActivityEventRow[] = [];
    const saga = startPersistActivitySaga({
      insert: (row) => {
        inserted.push(row);
        return Promise.resolve();
      },
      upsertActorRole: () => Promise.resolve(),
    });

    emit({
      type: EventType.ArtifactRequestSettled,
      requestId: "req-1",
      artifactId: "art-1",
      agentId: "agent-1",
      ownerSub: "o1",
      seq: 2,
      action: "refresh",
      state: "failed",
      failureReason: "expired",
      actorSub: "o1",
      surface: "ui",
    });
    await Promise.resolve();
    saga.unsubscribe();

    expect(inserted).toEqual([
      {
        type: "artifact_request",
        actorSub: "o1",
        agentId: "agent-1",
        surface: "ui",
        outcome: "failure",
        payload: {
          artifactId: "art-1",
          requestId: "req-1",
          action: "refresh",
          seq: 2,
          failureReason: "expired",
        },
      },
    ]);
  });

  // TEST_SCENARIO: The expiry sweep settles with no actor, so it must write nothing — an expiry is not something a person did.
  it("records nothing for a settle with no actor", async () => {
    const inserted: ActivityEventRow[] = [];
    const saga = startPersistActivitySaga({
      insert: (row) => {
        inserted.push(row);
        return Promise.resolve();
      },
      upsertActorRole: () => Promise.resolve(),
    });

    emit({
      type: EventType.ArtifactRequestSettled,
      requestId: "req-2",
      artifactId: "art-1",
      agentId: "agent-1",
      ownerSub: "o1",
      seq: 3,
      action: "tick",
      state: "failed",
      failureReason: "expired",
    });
    await Promise.resolve();
    saga.unsubscribe();

    expect(inserted).toEqual([]);
  });
});
