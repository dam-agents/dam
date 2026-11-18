import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import {
  fileResultInputSchema,
  satelliteConnectInputSchema,
  type FileWorkItem,
  type SatelliteView,
} from "api-server-api";
import type { MountMcpDeps } from "../../apps/harness-api-server/mcp-endpoint.js";
import {
  mountMcpRoutes,
  satelliteMountInstructions,
} from "../../apps/harness-api-server/mcp-endpoint.js";
import { configureLogger } from "../../core/logger.js";
import type { SatelliteRow } from "../../modules/satellites/domain/types.js";
import { createAgentFileChannelRoutes } from "../../modules/satellites/routes/agent-file-channel.js";
import {
  createSatelliteFileChannel,
  type SatelliteFileChannel,
} from "../../modules/satellites/services/file-channel.js";
import { registerSatelliteTools } from "../../modules/satellites/mcp-tools.js";
import { createSatelliteWorkerOps } from "../../modules/satellites/services/worker-ops.js";
import {
  fakeBlobs,
  fakeRedis,
  fakeRedisBus,
} from "../helpers/satellite-fakes.js";

/**
 * TEST_OVERVIEW: The file channel — the path an Agent's mount takes to a
 * machine, beside Jobs. An operation is queued in the shared store on whichever
 * replica the Agent's request landed on, claimed by the replica holding that
 * machine's long-poll, and answered on the claiming replica back to the waiting
 * request. The channel refuses what the platform can decide alone — a grant it
 * does not hold, a change without `--write`, a machine that is offline or
 * shutting down, a grant just revoked — and bounds how much one Agent can leave
 * in flight. It keeps one record line per Agent, Satellite and minute, with no
 * path in it.
 */

const OWNER = "alice";
const SATELLITE = "lab";
const AGENT = "agent-1";
const OTHER_AGENT = "agent-2";
const INCARNATION = "11111111-1111-4111-8111-111111111111";

function row(patch: Partial<SatelliteRow> = {}): SatelliteRow {
  return {
    owner: OWNER,
    name: SATELLITE,
    kind: "files",
    filesWritable: true,
    description: null,
    host: "lab.local",
    maxConcurrent: 16,
    tools: [],
    draining: false,
    lastSeenAt: new Date(),
    incarnation: INCARNATION,
    createdAt: new Date("2026-11-18T12:00:00Z"),
    ...patch,
  };
}

function replica(
  store: Redis,
  bus: ReturnType<typeof fakeRedisBus>,
  blobs: ReturnType<typeof fakeBlobs>,
  satellite: SatelliteRow = row(),
  now?: () => number,
) {
  const channel = createSatelliteFileChannel({
    redis: store,
    bus,
    blobs,
    agentName: async (agentId) => `Agent ${agentId}`,
    ...(now === undefined ? {} : { now }),
  });
  const workerOps = createSatelliteWorkerOps({
    repo: {
      get: async () => satellite,
      touch: async () => {},
      setDraining: async () => {},
      takeCancellations: async () => [],
      claimQueued: async () => [],
    } as never,
    fileChannel: channel,
    maxConcurrentCeiling: 64,
    deliverOutcome: async () => {},
  });
  return { channel, workerOps };
}

describe("how a satellite declares itself", () => {
  /**
   * TEST_SCENARIO: A file tree has no tools, so its manifest carries an empty
   * list and says whether its worker was started writable. A tool surface must
   * still offer at least one, and neither shape is read as the other.
   */
  it("accepts a file tree with no tools and refuses its missing files block", () => {
    const register = (manifest: Record<string, unknown>) =>
      satelliteConnectInputSchema.safeParse({ manifest }).success;

    expect(
      register({
        name: "lab",
        kind: "files",
        tools: [],
        files: { writable: true },
      }),
    ).toBe(true);
    expect(register({ name: "lab", kind: "files", tools: [] })).toBe(false);
    expect(register({ name: "lab", tools: [] })).toBe(false);
  });

  /**
   * TEST_SCENARIO: A manifest written before a Satellite had a kind says
   * nothing and is read as a tool surface, so registering an older worker keeps
   * working unchanged.
   */
  it("reads a manifest with no kind as a tool surface", () => {
    const parsed = satelliteConnectInputSchema.parse({
      manifest: {
        name: "gpu-box",
        tools: [{ name: "run", inputSchema: {} }],
      },
    });

    expect(parsed.manifest.kind).toBeUndefined();
    expect(parsed.manifest.files).toBeUndefined();
  });
});

describe("relaying one operation across two replicas", () => {
  /**
   * TEST_SCENARIO: The Agent's request lands on one replica and the machine's
   * long-poll is held by another, so the operation and its answer both have to
   * cross the store: the queue carries the id, the blob handoff carries the body,
   * and the result pub/sub carries the answer back to the waiting request.
   */
  it("hands the operation to the claiming replica and the answer back", async () => {
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const blobs = fakeBlobs();
    const a = replica(store, bus, blobs);
    const b = replica(store, bus, blobs);

    const deadline = Date.now() + 5_000;
    const queued = await a.channel.enqueue(
      OWNER,
      SATELLITE,
      INCARNATION,
      AGENT,
      "write",
      "notes/a.txt",
      { offset: 0, dev: 12, ino: 34 },
      Buffer.from("hello"),
      deadline,
    );
    if (!queued.ok) throw new Error("the operation was refused");
    const waiting = a.channel.awaitResult(queued.id);

    const items = (await b.workerOps.claim(OWNER, {
      satellite: SATELLITE,
      capacity: 4,
      waitMs: 200,
    })) as FileWorkItem[];

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "file",
      op: "write",
      path: "notes/a.txt",
      agent: { id: AGENT, name: `Agent ${AGENT}` },
    });
    expect(Buffer.from(items[0]!.data!, "base64").toString()).toBe("hello");

    await b.workerOps.fileResult(OWNER, {
      satellite: SATELLITE,
      id: items[0]!.id,
      incarnation: INCARNATION,
      ok: true,
      result: { kind: "file", size: 5 },
    });

    await expect(waiting).resolves.toEqual({
      ok: true,
      result: { kind: "file", size: 5 },
    });
  });

  /**
   * TEST_SCENARIO: A registration stamped after the operation was queued is a
   * different machine, so its answer is not this operation's. The answer is
   * dropped and the Agent's request ends at its deadline rather than being given
   * another machine's file.
   */
  it("drops an answer from another registration", async () => {
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const blobs = fakeBlobs();
    const a = replica(store, bus, blobs);
    const b = replica(store, bus, blobs);

    const deadline = Date.now() + 60;
    const queued = await a.channel.enqueue(
      OWNER,
      SATELLITE,
      INCARNATION,
      AGENT,
      "getattr",
      "notes/a.txt",
      undefined,
      undefined,
      deadline,
    );
    if (!queued.ok) throw new Error("the operation was refused");
    const waiting = a.channel.awaitResult(queued.id);
    const [item] = (await b.workerOps.claim(OWNER, {
      satellite: SATELLITE,
      capacity: 1,
      waitMs: 100,
    })) as FileWorkItem[];

    await b.workerOps.fileResult(OWNER, {
      satellite: SATELLITE,
      id: item!.id,
      incarnation: "22222222-2222-4222-8222-222222222222",
      ok: true,
      result: { kind: "file", size: 5 },
    });

    await expect(waiting).resolves.toEqual({ ok: false, errno: "EIO" });
  });

  /**
   * TEST_SCENARIO: An answer that names another Satellite or another
   * registration is not this operation's, so it must neither resolve the request
   * nor spend the in-flight place the operation holds — the genuine answer is
   * still accepted afterwards, and the count ends where it started.
   */
  it("rejects an answer out of scope and still accepts the genuine one", async () => {
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const blobs = fakeBlobs();
    const a = replica(store, bus, blobs);
    const inflight = `satfile:inflight:${OWNER}:${SATELLITE}:${AGENT}`;

    const queued = await a.channel.enqueue(
      OWNER,
      SATELLITE,
      INCARNATION,
      AGENT,
      "getattr",
      "notes/a.txt",
      undefined,
      undefined,
      Date.now() + 5_000,
    );
    if (!queued.ok) throw new Error("the operation was refused");
    const waiting = a.channel.awaitResult(queued.id);
    const genuine = {
      satellite: SATELLITE,
      id: queued.id,
      incarnation: INCARNATION,
      ok: true as const,
      result: { kind: "file", size: 1 },
    };

    await a.channel.settle(OWNER, { ...genuine, satellite: "other" });
    await a.channel.settle("mallory", { ...genuine, satellite: SATELLITE });
    await a.channel.settle(OWNER, {
      ...genuine,
      incarnation: "22222222-2222-4222-8222-222222222222",
    });

    expect(await store.get(inflight)).toBe("1");
    expect(bus.published("satfile:res:")).toHaveLength(0);

    await a.channel.settle(OWNER, genuine);

    await expect(waiting).resolves.toEqual({
      ok: true,
      result: { kind: "file", size: 1 },
    });
    expect(await store.get(inflight)).toBe("0");
  });

  /**
   * TEST_SCENARIO: A worker can answer twice — a retry after a dropped
   * connection, or a bug. The operation is taken in the same step its answer is
   * checked, so the second answer finds nothing and the waiting request is
   * resolved once.
   */
  it("takes an answer once", async () => {
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const blobs = fakeBlobs();
    const a = replica(store, bus, blobs);

    const deadline = Date.now() + 5_000;
    const queued = await a.channel.enqueue(
      OWNER,
      SATELLITE,
      INCARNATION,
      AGENT,
      "getattr",
      "notes/a.txt",
      undefined,
      undefined,
      deadline,
    );
    if (!queued.ok) throw new Error("the operation was refused");
    const waiting = a.channel.awaitResult(queued.id);
    const answer = {
      satellite: SATELLITE,
      id: queued.id,
      incarnation: INCARNATION,
      ok: true as const,
      result: { kind: "file", size: 1 },
    };
    await a.workerOps.fileResult(OWNER, answer);
    await a.workerOps.fileResult(OWNER, answer);

    await expect(waiting).resolves.toEqual({
      ok: true,
      result: { kind: "file", size: 1 },
    });
    expect(bus.published("satfile:res:")).toHaveLength(1);
  });
});

describe("fairness and bounds", () => {
  /**
   * TEST_SCENARIO: A worker can answer in the instant between the platform
   * queueing the operation and the route asking for its answer; that answer is
   * the operation's and must not be lost.
   */
  it("keeps an answer that arrives before the route waits for it", async () => {
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const blobs = fakeBlobs();
    const a = replica(store, bus, blobs);

    const queued = await a.channel.enqueue(
      OWNER,
      SATELLITE,
      INCARNATION,
      AGENT,
      "getattr",
      "notes/a.txt",
      undefined,
      undefined,
      Date.now() + 5_000,
    );
    if (!queued.ok) throw new Error("the operation was refused");
    await a.channel.settle(OWNER, {
      satellite: SATELLITE,
      id: queued.id,
      incarnation: INCARNATION,
      ok: true,
      result: { kind: "file", size: 1 },
    });

    await expect(a.channel.awaitResult(queued.id)).resolves.toEqual({
      ok: true,
      result: { kind: "file", size: 1 },
    });
    await expect(a.channel.awaitResult(queued.id)).resolves.toEqual({
      ok: false,
      errno: "EIO",
    });
  });

  /**
   * TEST_SCENARIO: One Agent walking a large tree must not starve another
   * Agent's single read: a claim pass takes at most one operation per Agent, in
   * rotation, and only a further pass takes a second, so two Agents' queues
   * advance together even when the claim has room for both.
   */
  it("takes one operation per Agent per turn, in rotation", async () => {
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const blobs = fakeBlobs();
    const a = replica(store, bus, blobs);
    const deadline = Date.now() + 5_000;

    const queued: { id: string; agentId: string }[] = [];
    for (let index = 0; index < 3; index++) {
      for (const agentId of [AGENT, OTHER_AGENT]) {
        const result = await a.channel.enqueue(
          OWNER,
          SATELLITE,
          INCARNATION,
          agentId,
          "getattr",
          "notes/a.txt",
          undefined,
          undefined,
          deadline,
        );
        if (!result.ok) throw new Error("the operation was refused");
        queued.push({ id: result.id, agentId });
      }
    }

    const first = (await a.channel.take(
      OWNER,
      SATELLITE,
      INCARNATION,
      4,
      0,
    )) as FileWorkItem[];
    const second = (await a.channel.take(
      OWNER,
      SATELLITE,
      INCARNATION,
      4,
      0,
    )) as FileWorkItem[];

    expect(first.map((item) => item.agent?.id)).toEqual([
      AGENT,
      OTHER_AGENT,
      AGENT,
      OTHER_AGENT,
    ]);
    expect(second.map((item) => item.agent?.id).sort()).toEqual([
      AGENT,
      OTHER_AGENT,
    ]);
    expect(new Set([...first, ...second].map((item) => item.id)).size).toBe(6);
  });

  /**
   * TEST_SCENARIO: A lone Agent's walk must fill the claim rather than spend one
   * round trip per file: after each Agent has had its turn, the passes repeat
   * while the claim has room.
   */
  it("fills a claim from a single Agent's queue", async () => {
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const blobs = fakeBlobs();
    const a = replica(store, bus, blobs);
    const deadline = Date.now() + 5_000;
    for (let index = 0; index < 5; index++) {
      const result = await a.channel.enqueue(
        OWNER,
        SATELLITE,
        INCARNATION,
        AGENT,
        "getattr",
        "notes/a.txt",
        undefined,
        undefined,
        deadline,
      );
      if (!result.ok) throw new Error("the operation was refused");
    }

    const items = (await a.channel.take(
      OWNER,
      SATELLITE,
      INCARNATION,
      4,
      0,
    )) as FileWorkItem[];

    expect(items).toHaveLength(4);
    expect(items.every((item) => item.agent?.id === AGENT)).toBe(true);
  });

  /**
   * TEST_SCENARIO: One claim's bodies are bounded, so a worker is never handed a
   * result it cannot hold: past the ceiling the claim answers with fewer items
   * than its capacity, and the rest wait for the next claim.
   */
  it("stops a claim at its byte ceiling", async () => {
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const blobs = fakeBlobs();
    const a = replica(store, bus, blobs);
    const deadline = Date.now() + 5_000;
    for (let index = 0; index < 2; index++) {
      const result = await a.channel.enqueue(
        OWNER,
        SATELLITE,
        INCARNATION,
        AGENT,
        "write",
        `notes/${index}.bin`,
        { offset: 0, dev: 1, ino: 2 },
        Buffer.alloc(5 * 1024 * 1024, 7),
        deadline,
      );
      if (!result.ok) throw new Error("the operation was refused");
    }

    const items = await a.channel.take(OWNER, SATELLITE, INCARNATION, 4, 0);

    expect(items).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: An operation that is claimed and then never answered leaves
   * its Agent's in-flight count at zero once it times out: a counter that went
   * negative would let the Agent past the bound that keeps one walk from filling
   * the shared store.
   */
  it("leaves the in-flight count at zero when a claimed operation times out", async () => {
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const blobs = fakeBlobs();
    const a = replica(store, bus, blobs);
    const inflight = `satfile:inflight:${OWNER}:${SATELLITE}:${AGENT}`;

    const queued = await a.channel.enqueue(
      OWNER,
      SATELLITE,
      INCARNATION,
      AGENT,
      "getattr",
      "notes/a.txt",
      undefined,
      undefined,
      Date.now() + 30,
    );
    if (!queued.ok) throw new Error("the operation was refused");
    const [item] = (await a.channel.take(
      OWNER,
      SATELLITE,
      INCARNATION,
      1,
      0,
    )) as FileWorkItem[];
    expect(item).toBeDefined();
    expect(await store.get(inflight)).toBe("1");

    await expect(a.channel.awaitResult(queued.id)).resolves.toEqual({
      ok: false,
      errno: "EIO",
    });
    expect(await store.get(inflight)).toBe("0");
  });

  /**
   * TEST_SCENARIO: A claimed operation that timed out and is then named by an end
   * for its whole Satellite must release its place once, not twice: a count that
   * went negative would let the Agent past the bound that keeps one walk from
   * filling the shared store.
   */
  it("leaves the in-flight count at zero after a timeout and a late end", async () => {
    const store = fakeRedis();
    const a = replica(store, fakeRedisBus(), fakeBlobs());
    const inflight = `satfile:inflight:${OWNER}:${SATELLITE}:${AGENT}`;

    const queued = await a.channel.enqueue(
      OWNER,
      SATELLITE,
      INCARNATION,
      AGENT,
      "getattr",
      "notes/a.txt",
      undefined,
      undefined,
      Date.now() + 30,
    );
    if (!queued.ok) throw new Error("the operation was refused");
    const [item] = await a.channel.take(OWNER, SATELLITE, INCARNATION, 1, 0);
    expect(item).toBeDefined();
    await expect(a.channel.awaitResult(queued.id)).resolves.toEqual({
      ok: false,
      errno: "EIO",
    });

    await a.channel.satelliteOffline(OWNER, SATELLITE);

    expect(await store.get(inflight)).toBe("0");
  });

  /**
   * TEST_SCENARIO: An Agent that opens more operations than a machine can hold
   * is refused rather than allowed to fill the shared store. The bound is per
   * Agent and Satellite, so one runaway walk does not cost the others their
   * channel.
   */
  it("refuses the sixty-fifth operation in flight", async () => {
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const blobs = fakeBlobs();
    const a = replica(store, bus, blobs);
    const deadline = Date.now() + 5_000;

    for (let index = 0; index < 64; index++) {
      const result = await a.channel.enqueue(
        OWNER,
        SATELLITE,
        INCARNATION,
        AGENT,
        "getattr",
        "notes/a.txt",
        undefined,
        undefined,
        deadline,
      );
      expect(result.ok).toBe(true);
    }
    const refused = await a.channel.enqueue(
      OWNER,
      SATELLITE,
      INCARNATION,
      AGENT,
      "getattr",
      "notes/a.txt",
      undefined,
      undefined,
      deadline,
    );

    expect(refused).toEqual({ ok: false, errno: "EIO" });
    const other = await a.channel.enqueue(
      OWNER,
      SATELLITE,
      INCARNATION,
      OTHER_AGENT,
      "getattr",
      "notes/a.txt",
      undefined,
      undefined,
      deadline,
    );
    expect(other.ok).toBe(true);
  });

  /**
   * TEST_SCENARIO: An operation past its deadline must never run: the Agent has
   * already been told it failed, so a late write would change the machine after
   * the fact. A claim drops it and its record with it.
   */
  it("drops an operation past its deadline at claim time", async () => {
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const blobs = fakeBlobs();
    const a = replica(store, bus, blobs);

    const queued = await a.channel.enqueue(
      OWNER,
      SATELLITE,
      INCARNATION,
      AGENT,
      "getattr",
      "notes/a.txt",
      undefined,
      undefined,
      Date.now() - 1,
    );
    if (!queued.ok) throw new Error("the operation was refused");

    const items = await a.channel.take(OWNER, SATELLITE, INCARNATION, 4, 0);

    expect(items).toEqual([]);
    expect(store.has(`satfile:op:${queued.id}`)).toBe(false);
  });
});

describe("what the platform refuses alone", () => {
  function routes(
    satellite: SatelliteRow | null,
    channel: SatelliteFileChannel,
  ) {
    const app = new Hono();
    app.route(
      "/",
      createAgentFileChannelRoutes({
        ownerOf: async (agentId) => (agentId === AGENT ? OWNER : null),
        repo: {
          grantedSatellite: async () => satellite,
          grantedFilesSatellites: async () =>
            satellite === null
              ? []
              : [
                  {
                    name: satellite.name,
                    writable: satellite.filesWritable,
                    online: satellite.lastSeenAt !== null,
                    draining: satellite.draining,
                  },
                ],
        },
        fileChannel: channel,
      }),
    );
    return app;
  }

  function op(body: Record<string, unknown>) {
    return {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  const channelOf = (store = fakeRedis()) =>
    replica(store, fakeRedisBus(), fakeBlobs()).channel;

  /**
   * TEST_SCENARIO: A grant is what makes a mount reachable, and it is checked on
   * every operation because the mount server decides nothing. An Agent whose
   * grant is gone is refused at once, with the errno its tools show for a
   * permission failure.
   */
  it("refuses an operation with no grant", async () => {
    const response = await routes(null, channelOf()).request(
      `/api/agents/${AGENT}/satellite-files/${SATELLITE}/op`,
      op({ op: "getattr", path: "a.txt" }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, errno: "EACCES" });
  });

  /**
   * TEST_SCENARIO: A Satellite started without `--write` answers `EROFS` for
   * every change, and reads still work. The refusal is the platform's, so it
   * costs no round trip to the machine.
   */
  it("refuses a change on a read-only satellite", async () => {
    const channel = channelOf();
    const app = routes(row({ filesWritable: false }), channel);

    const change = await app.request(
      `/api/agents/${AGENT}/satellite-files/${SATELLITE}/op`,
      op({ op: "create", path: "a.txt", mode: 420, exclusive: false }),
    );
    expect(change.status).toBe(200);
    expect(await change.json()).toEqual({ ok: false, errno: "EROFS" });
  });

  /**
   * TEST_SCENARIO: A machine that is offline or shutting down answers "Host is
   * down" at once, so a scheduled turn does not wait out an operation nobody
   * will claim.
   */
  it("answers Host is down while the satellite is offline or draining", async () => {
    for (const satellite of [
      row({ lastSeenAt: null }),
      row({ draining: true }),
    ]) {
      const response = await routes(satellite, channelOf()).request(
        `/api/agents/${AGENT}/satellite-files/${SATELLITE}/op`,
        op({ op: "getattr", path: "a.txt" }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, errno: "EHOSTDOWN" });
    }
  });

  /**
   * TEST_SCENARIO: A grant revoked a moment ago still reads as a grant in the
   * database, so the marker the revocation leaves is what refuses the operation
   * before it reaches the machine.
   */
  it("refuses an operation under a revoked grant", async () => {
    const channel = channelOf();
    await channel.revoke(OWNER, SATELLITE, AGENT);

    const response = await routes(row(), channel).request(
      `/api/agents/${AGENT}/satellite-files/${SATELLITE}/op`,
      op({ op: "getattr", path: "a.txt" }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, errno: "EACCES" });
  });

  /**
   * TEST_SCENARIO: A revoked grant must not be overtaken by an operation already
   * queued or one arriving a moment later: the revocation deletes what is
   * waiting and answers its request at once, the queue holds nothing to claim
   * afterwards, and an operation enqueued past the marker is refused even though
   * the grant row still reads as granted. Granting again has to lift the marker,
   * or a re-add within the marker's minute would be refused by it.
   */
  it("ends a waiting operation and refuses the next one when the grant is revoked", async () => {
    const store = fakeRedis();
    const a = replica(store, fakeRedisBus(), fakeBlobs());
    const deadline = Date.now() + 5_000;
    const queued = await a.channel.enqueue(
      OWNER,
      SATELLITE,
      INCARNATION,
      AGENT,
      "getattr",
      "notes/a.txt",
      undefined,
      undefined,
      deadline,
    );
    if (!queued.ok) throw new Error("the operation was refused");
    const waiting = a.channel.awaitResult(queued.id);

    await a.channel.revoke(OWNER, SATELLITE, AGENT);

    await expect(waiting).resolves.toEqual({ ok: false, errno: "EACCES" });
    expect(await a.channel.take(OWNER, SATELLITE, INCARNATION, 4, 0)).toEqual(
      [],
    );
    expect(
      await a.channel.enqueue(
        OWNER,
        SATELLITE,
        INCARNATION,
        AGENT,
        "getattr",
        "notes/a.txt",
        undefined,
        undefined,
        deadline,
      ),
    ).toEqual({ ok: false, errno: "EACCES" });

    await a.channel.clearRevoked(OWNER, SATELLITE, AGENT);

    expect(
      await a.channel.enqueue(
        OWNER,
        SATELLITE,
        INCARNATION,
        AGENT,
        "getattr",
        "notes/a.txt",
        undefined,
        undefined,
        deadline,
      ),
    ).toMatchObject({ ok: true });
  });

  /**
   * TEST_SCENARIO: The op body is strict. An unknown key would be a field the
   * platform silently drops, so the request is refused instead of being served
   * with a default the Agent did not ask for.
   */
  it("refuses an operation body it does not understand", async () => {
    const response = await routes(row(), channelOf()).request(
      `/api/agents/${AGENT}/satellite-files/${SATELLITE}/op`,
      op({ op: "getattr", path: "a.txt", follow: true }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, errno: "EINVAL" });
  });

  /**
   * TEST_SCENARIO: The listing is what the mount polls every 30 seconds, and
   * the same call is how the platform learns the mount server is running — which
   * is what gates the session's instructions.
   */
  it("lists the Agent's file satellites and records presence", async () => {
    const channel = channelOf();
    const app = routes(row({ filesWritable: false }), channel);

    const response = await app.request(`/api/agents/${AGENT}/satellite-files`);

    expect(await response.json()).toEqual({
      satellites: [{ name: SATELLITE, writable: false, online: true }],
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await channel.isPresent(AGENT)).toBe(true);
  });
});

describe("a store that stops answering", () => {
  afterEach(() => {
    configureLogger({ level: "error", write: () => {} });
  });

  /**
   * TEST_SCENARIO: An ioredis failure carries the command and its arguments, and
   * an operation's arguments hold a path. The request answers EIO and the log
   * names only the code, so the path never reaches either.
   */
  it("answers EIO and logs no path", async () => {
    const lines: string[] = [];
    configureLogger({ level: "warn", write: (line) => lines.push(line) });
    const failure = Object.assign(
      new Error("SET satfile:op:secret/plan.txt failed"),
      { code: "ERR_FAKE", command: { args: ["secret/plan.txt"] } },
    );
    const store = fakeRedis({ failOn: "set", failWith: failure });
    const app = new Hono();
    app.route(
      "/",
      createAgentFileChannelRoutes({
        ownerOf: async (agentId) => (agentId === AGENT ? OWNER : null),
        repo: {
          grantedSatellite: async () => row(),
          grantedFilesSatellites: async () => [],
        },
        fileChannel: replica(store, fakeRedisBus(), fakeBlobs()).channel,
      }),
    );

    const response = await app.request(
      `/api/agents/${AGENT}/satellite-files/${SATELLITE}/op`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "getattr", path: "secret/plan.txt" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, errno: "EIO" });
    const logged = lines.join("\n");
    expect(logged).toContain("ERR_FAKE");
    expect(logged).not.toContain("secret/plan.txt");
  });
});

describe("an operation that moved no bytes", () => {
  /**
   * TEST_SCENARIO: A read at the end of a file answers no bytes, which is a
   * successful read of nothing rather than a malformed answer; the schema allows
   * empty data for it and the answer reaches the waiting request.
   */
  it("settles an empty read", async () => {
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const a = replica(store, bus, fakeBlobs());
    const queued = await a.channel.enqueue(
      OWNER,
      SATELLITE,
      INCARNATION,
      AGENT,
      "read",
      "notes/a.txt",
      { offset: 4096, size: 4096, dev: 1, ino: 2 },
      undefined,
      Date.now() + 5_000,
    );
    if (!queued.ok) throw new Error("the operation was refused");
    const waiting = a.channel.awaitResult(queued.id);

    await a.channel.settle(OWNER, {
      satellite: SATELLITE,
      id: queued.id,
      incarnation: INCARNATION,
      ok: true,
      data: "",
    });

    await expect(waiting).resolves.toEqual({ ok: true, data: "" });
  });

  it("accepts an empty body in the contract", () => {
    const parsed = fileResultInputSchema.safeParse({
      satellite: SATELLITE,
      id: "11111111-1111-4111-8111-111111111111",
      incarnation: INCARNATION,
      ok: true,
      data: "",
    });

    expect(parsed.success).toBe(true);
  });
});

describe("the record", () => {
  afterEach(() => {
    configureLogger({ level: "error", write: () => {} });
  });

  /**
   * TEST_SCENARIO: The record is one line per Agent, Satellite and minute, and
   * it says what was done without ever saying which file: an Agent's reads and
   * deletions leave counts, never a path. One replica wins the minute's flush key,
   * so a pair is logged once however many replicas relayed its operations.
   */
  it("logs one line per pair per minute across replicas, with no path", async () => {
    const lines: string[] = [];
    configureLogger({ level: "info", write: (line) => lines.push(line) });
    const store = fakeRedis();
    const bus = fakeRedisBus();
    const blobs = fakeBlobs();
    let clock = Date.UTC(2026, 10, 18, 12, 0, 0);
    const now = () => clock;
    const a = replica(store, bus, blobs, row(), now);
    const b = replica(store, bus, blobs, row(), now);
    const deadline = clock + 5_000;

    async function relay(
      channel: SatelliteFileChannel,
      op: string,
      path: string | undefined,
      args: Record<string, unknown> | undefined,
      data: Buffer | undefined,
      answer: { ok: boolean; data?: string },
    ) {
      const queued = await channel.enqueue(
        OWNER,
        SATELLITE,
        INCARNATION,
        AGENT,
        op,
        path,
        args,
        data,
        deadline,
      );
      if (!queued.ok) throw new Error("the operation was refused");
      await channel.settle(OWNER, {
        satellite: SATELLITE,
        id: queued.id,
        incarnation: INCARNATION,
        ...answer,
      });
    }

    await relay(
      a.channel,
      "read",
      "secret/plan.txt",
      { dev: 1, ino: 2 },
      undefined,
      { ok: true, data: Buffer.from("abc").toString("base64") },
    );
    await relay(
      b.channel,
      "read",
      "secret/plan.txt",
      { dev: 1, ino: 2 },
      undefined,
      { ok: true, data: Buffer.from("abc").toString("base64") },
    );
    await relay(
      a.channel,
      "write",
      "secret/plan.txt",
      { dev: 1, ino: 2 },
      Buffer.from("hello"),
      { ok: true },
    );
    await relay(a.channel, "unlink", "secret/plan.txt", undefined, undefined, {
      ok: true,
    });

    clock += 60_000;
    await a.channel.flushSummary();
    await b.channel.flushSummary();

    const records = lines.map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      msg: "satellites.file-channel",
      owner: OWNER,
      agentId: AGENT,
      satellite: SATELLITE,
      ops: 4,
      filesOpened: 1,
      bytesRead: 6,
      bytesWritten: 5,
      deleted: 1,
    });
    expect(records[0]).not.toHaveProperty("path");
    expect(lines[0]).not.toContain("secret/plan.txt");
  });
});

describe("what a files satellite offers", () => {
  /**
   * TEST_SCENARIO: AC-11. A file tree has no tools, so the platform MCP server
   * registers none for it — not even the three job verbs, which would be tools an
   * Agent could call to no effect.
   */
  it("registers no tools at all for a file tree, job verbs included", () => {
    const names: string[] = [];
    const server = {
      registerTool: (name: string) => names.push(name),
      tool: (name: string) => names.push(name),
    };
    const view: SatelliteView = {
      name: SATELLITE,
      kind: "files",
      filesWritable: true,
      description: null,
      host: "lab.local",
      online: true,
      draining: false,
      lastSeenAt: null,
      tools: [],
      maxConcurrent: 16,
      activeJobs: 0,
      grantedAgentIds: [AGENT],
    };

    registerSatelliteTools(server as never, {
      ops: {} as never,
      agentId: AGENT,
      satellites: [view],
      waitDeadlineMs: 1000,
    });

    expect(names).toEqual([]);
  });
});

describe("what a session is told about its mounts", () => {
  /**
   * TEST_SCENARIO: AC-11. The instructions name each mount and whether it is
   * writable, and they name none before the mount server has been seen: an
   * Agent on a machine that has not booted it must not be told about a
   * directory that is not there.
   */
  it("names the mounts only with a files grant and a live mount server", async () => {
    expect(
      satelliteMountInstructions([{ name: SATELLITE, writable: true }], false),
    ).toBeNull();
    expect(satelliteMountInstructions([], true)).toBeNull();

    const text = satelliteMountInstructions(
      [
        { name: SATELLITE, writable: true },
        { name: "docs", writable: false },
      ],
      true,
    );
    expect(text).toContain(`/mnt/sat/${SATELLITE} (writable)`);
    expect(text).toContain("/mnt/sat/docs (read-only)");
    expect(text).toContain("Host is down");
    expect(text).toContain("Stale file handle");
    expect(text).toContain("Operation not permitted");
  });

  /**
   * TEST_SCENARIO: The gate is in the session, not only in the helper: a replica
   * that has not seen this Agent's mount server serves instructions with no
   * mount words at all, and the same session names them once presence is there.
   */
  it("serves a session with the mounts only once presence is recorded", async () => {
    let present = false;
    const app = new Hono();
    mountMcpRoutes(app, {
      channelManager: {
        supportsUserLookup: async () => false,
        supportsMessageReactions: async () => false,
      },
      readAgent: async () => ({
        metadata: {
          labels: { "agent-platform.ai/owner": OWNER },
          uid: "u",
        },
        spec: {},
      }),
      k8s: { namespace: "platform" },
      composeSkills: () => ({}),
      schedulesServiceFor: () => ({}),
      artifactLibraryFor: () => ({}),
      invocationsServiceFor: () => ({}),
      driverOpsFor: () => ({}),
      subAgentAwaitsFor: () => ({}),
      carriesInspectorRole: async () => false,
      readsChannelHistory: async () => false,
      chatFormPreferences: async () => null,
      caseStudySubmissions: {},
      caseStudyInspection: {},
      agentImage: async () => null,
      environments: async () => null,
      keptSubAgents: async () => false,
      agentTelemetry: {},
      satelliteMounts: {
        filesFor: async () => [
          { name: SATELLITE, writable: false, online: true },
        ],
        isPresent: async () => present,
      },
    } as unknown as MountMcpDeps);

    const instructions = async () => {
      const response = await app.request(
        `http://harness/api/agents/${AGENT}/mcp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "probe", version: "1" },
            },
          }),
        },
      );
      const body = await response.text();
      const line = body.split("\n").find((entry) => entry.startsWith("data:"));
      const json = JSON.parse(line ? line.slice(5) : body);
      return json.result.instructions as string;
    };

    expect(await instructions()).not.toContain("/mnt/sat");
    present = true;
    expect(await instructions()).toContain(`/mnt/sat/${SATELLITE}`);
  });
});
