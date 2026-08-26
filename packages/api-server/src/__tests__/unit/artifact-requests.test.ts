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
import type { ActivityEventRow } from "../../modules/usage/domain/types.js";
import { startPersistActivitySaga } from "../../modules/usage/sagas/persist-activity.js";

// TEST_OVERVIEW: An Artifact Request is one thing an interactive page asked its agent to do — a button clicked, a choice made in a dropdown, a form submitted. `action` names what was asked. The owner may only ask through a page that is interactive, private, and theirs, and the page must have an agent to ask. Requests are numbered per artifact, at most one is in flight at a time (a second gets `busy`, never a queue), and no more than 60 land in a rolling hour (past that, `rate_limited`). Every settle raises a live event so the app refetches. A request a person made is recorded in the activity log; an automatic one has no actor and must not reach it.

type PageOverrides = Partial<{
  id: string;
  owner: string;
  agentId: string | null;
  interactive: boolean;
  visibility: string;
}>;

function page(overrides: PageOverrides = {}) {
  return {
    id: "art-1",
    owner: "o1",
    agentId: "agent-1",
    interactive: true,
    visibility: "private",
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
  return { getArtifact } as unknown as ArtifactLibraryRepository;
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

function serviceOver(
  pages: ReturnType<typeof page>[],
  rows: ArtifactRequestRow[] = [],
  owner = "o1",
) {
  return createArtifactRequestsService({
    requests: fakeRequests(rows),
    library: fakeLibrary(pages),
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
    trigger: "user",
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
  const load = { inFlight: false, requestsInWindow: 0 };

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
        trigger: "user",
      }),
    ).resolves.toMatchObject({ seq: 1, state: "pending" });
  });

  // TEST_SCENARIO: seq numbers the requests of one page in order, so a page can tell which answer belongs to which request.
  it("numbers each request of the same page in turn", async () => {
    const rows: ArtifactRequestRow[] = [];
    const service = serviceOver([page()], rows);
    const first = await service.create({
      artifactId: "art-1",
      action: "refresh",
      trigger: "user",
    });
    await service.cancel(first.requestId);
    await expect(
      service.create({
        artifactId: "art-1",
        action: "refresh",
        trigger: "auto",
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
        trigger: "user",
      }),
    ).rejects.toThrow(/artifact not found/);
  });

  // TEST_SCENARIO: The three refusals a caller can act on differently: a mistake, a page that must stay unshared, and a temporary state.
  it("gives a non-interactive page, a shared page and a busy page distinct errors", async () => {
    const plain = serviceOver([page({ interactive: false })]);
    await expect(
      plain.create({ artifactId: "art-1", action: "a", trigger: "user" }),
    ).rejects.toThrow(/not interactive/);

    const shared = serviceOver([page({ visibility: "public" })]);
    await expect(
      shared.create({ artifactId: "art-1", action: "a", trigger: "user" }),
    ).rejects.toThrow(/shared page cannot ask/);

    const busy = serviceOver([page()]);
    await busy.create({ artifactId: "art-1", action: "a", trigger: "user" });
    await expect(
      busy.create({ artifactId: "art-1", action: "a", trigger: "user" }),
    ).rejects.toThrow(/already waiting on an answer/);
  });

  // TEST_SCENARIO: The page renders its own copy per reason, so the refusal must carry a machine-readable reason and not just a sentence.
  it("carries the named reason on the error cause", async () => {
    const service = serviceOver([page()]);
    await service.create({ artifactId: "art-1", action: "a", trigger: "user" });
    const error = await service
      .create({ artifactId: "art-1", action: "a", trigger: "user" })
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
      .create({ artifactId: "art-1", action: "a", trigger: "user" })
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
      service.create({ artifactId: "art-1", action: "a", trigger: "user" }),
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
      owner: "o1",
      surface: "ui",
    });
    await service.create({ artifactId: "art-1", action: "a", trigger: "user" });
    await expect(
      service.create({ artifactId: "art-1", action: "a", trigger: "user" }),
    ).rejects.toThrow(/already waiting on an answer/);
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
      trigger: "user",
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

  // TEST_SCENARIO: An automatic request had no person behind it, so the settle event must carry no actor — that absence is what keeps it out of the activity log.
  it("names an actor only for a request a person made", async () => {
    const rows: ArtifactRequestRow[] = [];
    const service = serviceOver([page()], rows);
    const auto = await service.create({
      artifactId: "art-1",
      action: "tick",
      trigger: "auto",
    });

    const { seen, stop } = collect();
    await service.cancel(auto.requestId);
    stop();

    expect(seen[0]).not.toHaveProperty("actorSub");
    expect(seen[0]).not.toHaveProperty("surface");
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

  // TEST_SCENARIO: A request a person made is product usage and belongs in the activity log, with the outcome of the turn it paid for.
  it("records a request a person made", async () => {
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

  // TEST_SCENARIO: An automatic request has no actor, so it must write nothing — otherwise a page refreshing itself would inflate every usage number.
  it("records nothing for an automatic request", async () => {
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
      state: "answered",
    });
    await Promise.resolve();
    saga.unsubscribe();

    expect(inserted).toEqual([]);
  });
});
