import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type {
  FileResultInput,
  FileWorkItem,
  SatelliteFileErrno,
} from "api-server-api";
import type { BlobHandoff } from "../../../core/blob-handoff.js";
import { getLogger } from "../../../core/logger.js";
import type { RedisBus } from "../../../core/redis-bus.js";

export const FILE_OP_DEADLINE_MS = 30_000;

const OP_TTL_SECONDS = 60;
const INFLIGHT_MAX = 64;
const INFLIGHT_TTL_SECONDS = 120;
const SUMMARY_TTL_SECONDS = 180;
const PRESENCE_TTL_SECONDS = 45;
const REVOKED_TTL_SECONDS = 60;
const POLL_MS = 2_000;
const ENQUEUE_GUARD_MS = 2_000;
const CLAIM_DATA_MAX_CHARS = 8 * 1024 * 1024;

const WAKE_CHANNEL = "satfile:wake";
const END_CHANNEL = "satfile:end";

const CREATING_OPS = ["create", "mkdir", "symlink"];
const DELETING_OPS = ["unlink", "rmdir"];

const ENQUEUE_SCRIPT = `
-- satfile:enqueue
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
if redis.call('SADD', KEYS[2], ARGV[1]) == 1 then
  redis.call('RPUSH', KEYS[3], ARGV[1])
end
redis.call('RPUSH', KEYS[4], ARGV[2])
return 1
`;

const POP_SCRIPT = `
-- satfile:pop
local id = redis.call('LPOP', KEYS[1])
if redis.call('LLEN', KEYS[1]) == 0 then
  redis.call('SREM', KEYS[2], ARGV[1])
  redis.call('LREM', KEYS[3], 0, ARGV[1])
end
return id
`;

const RELEASE_SCRIPT = `
-- satfile:release
local value = tonumber(redis.call('GET', KEYS[1]) or '0')
if value > 0 then redis.call('DECR', KEYS[1]) end
return value
`;

type EnqueueWrite =
  | { ok: true; id: string }
  | { ok: false; errno: SatelliteFileErrno; blobKey?: string };

type FileAnswer =
  | { ok: true; result?: unknown; data?: string }
  | { ok: false; errno: SatelliteFileErrno };

interface OpRecord {
  owner: string;
  satellite: string;
  incarnation: string;
  agentId: string;
  holder: string;
  op: string;
  path?: string;
  args?: Record<string, unknown>;
  deadline: number;
  blobKey?: string;
  bytes?: number;
}

interface Pending {
  answer: Promise<FileAnswer>;
  settle: (answer: FileAnswer) => void;
  scope: { owner: string; satellite: string; agentId: string; queue: string };
  timer: ReturnType<typeof setTimeout>;
  finished: boolean;
  awaited: boolean;
}

interface Waiter {
  owner: string;
  satellite: string;
  wake: () => void;
}

const opKey = (id: string): string => `satfile:op:${id}`;
const queueKey = (owner: string, satellite: string, agentId: string): string =>
  `satfile:q:${owner}:${satellite}:${agentId}`;
const membersKey = (owner: string, satellite: string): string =>
  `satfile:agents:${owner}:${satellite}`;
const rotationKey = (owner: string, satellite: string): string =>
  `${membersKey(owner, satellite)}:rr`;
const inflightKey = (
  owner: string,
  satellite: string,
  agentId: string,
): string => `satfile:inflight:${owner}:${satellite}:${agentId}`;
const revokedKey = (
  owner: string,
  satellite: string,
  agentId: string,
): string => `satfile:revoked:${owner}:${satellite}:${agentId}`;
const presenceKey = (agentId: string): string => `satfile:present:${agentId}`;
const statKey = (
  minute: number,
  owner: string,
  satellite: string,
  agentId: string,
): string => `satfile:stat:${minute}:${owner}:${satellite}:${agentId}`;
const openKey = (
  minute: number,
  owner: string,
  satellite: string,
  agentId: string,
): string => `satfile:open:${minute}:${owner}:${satellite}:${agentId}`;
const flushKey = (minute: number): string => `satfile:flush:${minute}`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The only thing a failed command is allowed to say
 * about itself. An ioredis error carries the command and its arguments — an
 * operation's JSON, a path, a write's bytes — so the channel logs the code and
 * nothing else, and never hands the error on to a response.
 */
function codeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "Error";
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function recordOf(raw: string): OpRecord | null {
  const parsed = parseJson(raw);
  if (
    parsed === null ||
    typeof parsed.owner !== "string" ||
    typeof parsed.satellite !== "string" ||
    typeof parsed.incarnation !== "string" ||
    typeof parsed.agentId !== "string" ||
    typeof parsed.holder !== "string" ||
    typeof parsed.op !== "string" ||
    typeof parsed.deadline !== "number"
  )
    return null;
  return parsed as unknown as OpRecord;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The file channel, the third way work reaches a
 * machine beside Jobs and cancellations. A files Satellite has no Job rows: an
 * operation is queued in the shared store, wakes whichever replica holds that
 * machine's long-poll, travels as a claim item, and is answered on the request
 * that asked for it, so nothing about it is ever written to Postgres.
 *
 * Three small scripts carry the parts that must not interleave. Enqueue checks
 * the grant's revocation marker, adds the Agent to the rotation and pushes the id
 * in one act, so a revocation can never be overtaken and the rotation can never
 * be pushed twice. Pop takes an Agent's next id and, when that emptied the queue,
 * drops the Agent from the rotation in the same act, so the rotation is bounded by
 * the Agents with work and no enqueue can be lost beside it. Release decrements an
 * Agent's in-flight count only above zero.
 *
 * A claim pass hands at most one operation to each Agent, so one Agent's walk
 * cannot take a second turn ahead of another Agent's first; passes repeat until
 * the claim is full, its bytes are spent or a whole pass finds nothing, so a lone
 * Agent fills its claim in one round trip instead of one per file. A body rides a
 * blob the receiver puts and the claim takes exactly once, since it is far larger
 * than a queue item should be. Everything is owner-scoped, so one owner's replicas
 * never see another's machines.
 */
export function createSatelliteFileChannel(deps: {
  redis: Redis;
  bus: RedisBus;
  blobs: BlobHandoff;
  agentName?: (agentId: string) => Promise<string | null>;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  const holder = randomUUID();
  const resultChannel = `satfile:res:${holder}`;
  const pending = new Map<string, Pending>();
  const waiters = new Set<Waiter>();

  function failed(where: string, err: unknown): void {
    getLogger().warn(
      { where, code: codeOf(err) },
      "satellites.file-channel.failed",
    );
  }

  function forget(id: string): void {
    const entry = pending.get(id);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    pending.delete(id);
  }

  function claimTerminal(id: string): Pending | null {
    const entry = pending.get(id);
    if (entry === undefined || entry.finished) return null;
    entry.finished = true;
    return entry;
  }

  async function releaseInflight(
    owner: string,
    satellite: string,
    agentId: string,
  ): Promise<void> {
    await deps.redis.eval(
      RELEASE_SCRIPT,
      1,
      inflightKey(owner, satellite, agentId),
    );
  }

  async function dropQueued(
    id: string,
    scope: Pending["scope"],
  ): Promise<void> {
    await Promise.allSettled([
      deps.redis.lrem(scope.queue, 0, id),
      deps.redis.del(opKey(id)),
      releaseInflight(scope.owner, scope.satellite, scope.agentId),
    ]);
  }

  function abandon(
    id: string,
    errno: SatelliteFileErrno,
    options: { cleanup: boolean } = { cleanup: true },
  ): void {
    const entry = claimTerminal(id);
    if (entry === null) return;
    entry.settle({ ok: false, errno });
    if (entry.awaited) forget(id);
    if (!options.cleanup) return;
    void dropQueued(id, entry.scope).catch((err: unknown) =>
      failed("abandon", err),
    );
  }

  function watchDeadline(
    id: string,
    deadline: number,
  ): ReturnType<typeof setTimeout> {
    const timer = setTimeout(
      () => {
        const entry = pending.get(id);
        if (entry === undefined) return;
        if (entry.finished) {
          if (!entry.awaited) forget(id);
          return;
        }
        abandon(id, "EIO");
        if (!entry.awaited) forget(id);
      },
      Math.max(0, deadline - now()),
    );
    if (typeof timer.unref === "function") timer.unref();
    return timer;
  }

  deps.bus.subscribe(resultChannel, (payload) => {
    const parsed = parseJson(payload);
    if (parsed === null || typeof parsed.id !== "string") return;
    if (typeof parsed.ok !== "boolean") return;
    const entry = claimTerminal(parsed.id);
    if (entry === null) return;
    entry.settle({
      ok: parsed.ok,
      ...(typeof parsed.errno === "string"
        ? { errno: parsed.errno as SatelliteFileErrno }
        : {}),
      ...(parsed.result === undefined ? {} : { result: parsed.result }),
      ...(typeof parsed.data === "string" ? { data: parsed.data } : {}),
    } as FileAnswer);
    if (entry.awaited) forget(parsed.id);
  });

  deps.bus.subscribe(WAKE_CHANNEL, (payload) => {
    const parsed = parseJson(payload);
    if (parsed === null) return;
    for (const waiter of [...waiters]) {
      if (
        waiter.owner !== parsed.owner ||
        waiter.satellite !== parsed.satellite
      )
        continue;
      waiter.wake();
    }
  });

  deps.bus.subscribe(END_CHANNEL, (payload) => {
    const parsed = parseJson(payload);
    if (parsed === null || typeof parsed.owner !== "string") return;
    if (typeof parsed.satellite !== "string") return;
    const errno = parsed.reason === "revoked" ? "EACCES" : "EHOSTDOWN";
    for (const [id, entry] of [...pending]) {
      if (entry.finished) continue;
      if (entry.scope.owner !== parsed.owner) continue;
      if (entry.scope.satellite !== parsed.satellite) continue;
      if (
        typeof parsed.agentId === "string" &&
        entry.scope.agentId !== parsed.agentId
      )
        continue;
      abandon(id, errno);
      if (!entry.awaited) forget(id);
    }
  });

  function waitForWake(
    owner: string,
    satellite: string,
    ms: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(
        () => {
          waiters.delete(waiter);
          resolve();
        },
        Math.max(0, ms),
      );
      if (typeof timer.unref === "function") timer.unref();
      const waiter: Waiter = {
        owner,
        satellite,
        wake: () => {
          clearTimeout(timer);
          waiters.delete(waiter);
          resolve();
        },
      };
      waiters.add(waiter);
    });
  }

  async function countRelayed(
    owner: string,
    satellite: string,
    agentId: string,
    op: string,
    args: Record<string, unknown> | undefined,
    bytes: number | undefined,
  ): Promise<void> {
    const minute = Math.floor(now() / 60_000);
    const key = statKey(minute, owner, satellite, agentId);
    const counters: [string, number][] = [["ops", 1]];
    if (op === "write" && bytes !== undefined)
      counters.push(["bytesWritten", bytes]);
    if (CREATING_OPS.includes(op)) counters.push(["created", 1]);
    if (op === "rename") counters.push(["renamed", 1]);
    if (DELETING_OPS.includes(op)) counters.push(["deleted", 1]);
    /**
     * UNIT_BOUNDARY_DESCRIPTION: The counter's own commands are independent, so
     * they go together: run one after another they cost this operation seven
     * store round trips before the machine is even asked, which is the whole of
     * what a mounted tree pays between the guest and the worker when the machine
     * is close to the platform.
     */
    const writes: Promise<unknown>[] = [];
    for (const [field, by] of counters)
      writes.push(deps.redis.hincrby(key, field, by));
    writes.push(deps.redis.expire(key, SUMMARY_TTL_SECONDS));

    const ino = args?.ino;
    if (op === "read" && typeof ino === "number") {
      const set = openKey(minute, owner, satellite, agentId);
      writes.push(deps.redis.sadd(set, `${String(args?.dev)}:${ino}`));
      writes.push(deps.redis.expire(set, SUMMARY_TTL_SECONDS));
    }
    await Promise.all(writes);
  }

  async function countAnswered(
    record: OpRecord,
    input: FileResultInput,
  ): Promise<void> {
    if (!input.ok || record.op !== "read" || input.data === undefined) return;
    const minute = Math.floor(now() / 60_000);
    const key = statKey(minute, record.owner, record.satellite, record.agentId);
    await deps.redis.hincrby(
      key,
      "bytesRead",
      Buffer.from(input.data, "base64").length,
    );
    await deps.redis.expire(key, SUMMARY_TTL_SECONDS);
  }

  async function popForAgent(
    owner: string,
    satellite: string,
    agentId: string,
  ): Promise<string | null> {
    const id: unknown = await deps.redis.eval(
      POP_SCRIPT,
      3,
      queueKey(owner, satellite, agentId),
      membersKey(owner, satellite),
      rotationKey(owner, satellite),
      agentId,
    );
    return typeof id === "string" ? id : null;
  }

  async function recordAt(
    id: string,
    owner: string,
    satellite: string,
    incarnation: string,
  ): Promise<OpRecord | null> {
    const raw = await deps.redis.get(opKey(id));
    if (raw === null) return null;
    const record = recordOf(raw);
    if (
      record === null ||
      record.owner !== owner ||
      record.satellite !== satellite ||
      record.incarnation !== incarnation ||
      record.deadline < now()
    ) {
      await deps.redis.del(opKey(id));
      return null;
    }
    return record;
  }

  function carriedLength(record: OpRecord): number {
    return record.bytes === undefined ? 0 : Math.ceil(record.bytes / 3) * 4;
  }

  async function itemOf(
    id: string,
    record: OpRecord,
  ): Promise<FileWorkItem | null> {
    let data: string | undefined;
    if (record.blobKey !== undefined) {
      const body = await deps.blobs.take(record.blobKey);
      if (body === null) {
        await deps.redis.del(opKey(id));
        return null;
      }
      data = body.toString("base64");
    }
    const name =
      deps.agentName === undefined
        ? null
        : await deps.agentName(record.agentId).catch(() => null);
    return {
      kind: "file",
      id,
      op: record.op,
      ...(record.path === undefined ? {} : { path: record.path }),
      ...(record.args === undefined ? {} : { args: record.args }),
      ...(data === undefined ? {} : { data }),
      remainingMs: Math.max(0, record.deadline - now()),
      deadline: record.deadline,
      agent: { id: record.agentId, name },
    };
  }

  async function requeue(
    owner: string,
    satellite: string,
    agentId: string,
    id: string,
  ): Promise<void> {
    const accepted = Number(
      await deps.redis.eval(
        ENQUEUE_SCRIPT,
        4,
        revokedKey(owner, satellite, agentId),
        membersKey(owner, satellite),
        rotationKey(owner, satellite),
        queueKey(owner, satellite, agentId),
        agentId,
        id,
      ),
    );
    if (accepted === 0) await deps.redis.del(opKey(id)).catch(() => 0);
  }

  async function drain(
    owner: string,
    satellite: string,
    incarnation: string,
    capacity: number,
  ): Promise<FileWorkItem[]> {
    const items: FileWorkItem[] = [];
    const rotation = rotationKey(owner, satellite);
    let bytes = 0;
    let full = false;
    while (!full && items.length < capacity) {
      const agents = await deps.redis.llen(rotation);
      if (agents === 0) break;
      const visited = new Set<string>();
      let served = 0;
      for (let turn = 0; turn < agents; turn++) {
        if (items.length >= capacity) break;
        const agentId = await deps.redis.lmove(
          rotation,
          rotation,
          "LEFT",
          "RIGHT",
        );
        if (agentId === null || visited.has(agentId)) break;
        visited.add(agentId);
        const id = await popForAgent(owner, satellite, agentId);
        if (id === null) continue;
        const record = await recordAt(id, owner, satellite, incarnation);
        if (record === null) continue;
        if (bytes + carriedLength(record) > CLAIM_DATA_MAX_CHARS) {
          await requeue(owner, satellite, agentId, id);
          full = true;
          break;
        }
        const item = await itemOf(id, record);
        if (item === null) continue;
        items.push(item);
        bytes += item.data?.length ?? 0;
        served++;
      }
      if (served === 0) break;
    }
    return items;
  }

  return {
    /**
     * UNIT_BOUNDARY_DESCRIPTION: Queues one operation and returns its id. The
     * wait and its deadline are registered before the first store command, and the
     * queueing itself is raced against a two second local guard, so a store that
     * stops answering costs a request two seconds rather than its whole deadline.
     * A grant revoked while the request was in flight is refused by the enqueue
     * script itself, which deletes nothing the queue has not yet seen. The
     * counters are written here because this is the operation the platform
     * relayed — a change the machine then refused still reached it.
     */
    async enqueue(
      owner: string,
      satellite: string,
      incarnation: string,
      agentId: string,
      op: string,
      path: string | undefined,
      args: Record<string, unknown> | undefined,
      data: Buffer | undefined,
      deadline: number,
    ): Promise<
      { ok: true; id: string } | { ok: false; errno: SatelliteFileErrno }
    > {
      const id = randomUUID();
      const scope: Pending["scope"] = {
        owner,
        satellite,
        agentId,
        queue: queueKey(owner, satellite, agentId),
      };
      let settle!: (answer: FileAnswer) => void;
      const answer = new Promise<FileAnswer>((resolve) => {
        settle = resolve;
      });
      pending.set(id, {
        answer,
        settle,
        scope,
        timer: watchDeadline(id, deadline),
        finished: false,
        awaited: false,
      });

      const write = async (): Promise<EnqueueWrite> => {
        const inflight = inflightKey(owner, satellite, agentId);
        const queued = Number(await deps.redis.incr(inflight));
        await deps.redis.expire(inflight, INFLIGHT_TTL_SECONDS);
        if (queued > INFLIGHT_MAX) return { ok: false, errno: "EIO" };

        const blobKey =
          data === undefined ? undefined : await deps.blobs.put(data);
        const record: OpRecord = {
          owner,
          satellite,
          incarnation,
          agentId,
          holder,
          op,
          ...(path === undefined ? {} : { path }),
          ...(args === undefined ? {} : { args }),
          deadline,
          ...(blobKey === undefined ? {} : { blobKey }),
          ...(data === undefined ? {} : { bytes: data.length }),
        };
        await deps.redis.set(
          opKey(id),
          JSON.stringify(record),
          "EX",
          OP_TTL_SECONDS,
        );

        const accepted = Number(
          await deps.redis.eval(
            ENQUEUE_SCRIPT,
            4,
            revokedKey(owner, satellite, agentId),
            membersKey(owner, satellite),
            rotationKey(owner, satellite),
            scope.queue,
            agentId,
            id,
          ),
        );
        if (accepted === 0) {
          await deps.redis.del(opKey(id)).catch(() => 0);
          return {
            ok: false,
            errno: "EACCES",
            ...(blobKey === undefined ? {} : { blobKey }),
          };
        }

        await deps.bus.publish(
          WAKE_CHANNEL,
          JSON.stringify({ owner, satellite }),
        );
        void countRelayed(
          owner,
          satellite,
          agentId,
          op,
          args,
          data?.length,
        ).catch((err: unknown) => failed("count", err));
        return { ok: true, id };
      };

      let guarded = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const guard = new Promise<
        { ok: true; id: string } | { ok: false; errno: SatelliteFileErrno }
      >((resolve) => {
        timer = setTimeout(() => {
          guarded = true;
          resolve({ ok: false, errno: "EIO" });
        }, ENQUEUE_GUARD_MS);
        if (typeof timer.unref === "function") timer.unref();
      });

      const writing = write();
      let outcome: EnqueueWrite;
      try {
        outcome = await Promise.race([writing, guard]);
      } catch (err) {
        clearTimeout(timer);
        failed("enqueue", err);
        abandon(id, "EIO");
        return { ok: false, errno: "EIO" };
      }
      clearTimeout(timer);

      if (guarded) {
        abandon(id, "EIO", { cleanup: false });
        void writing
          .then((result) => {
            if (result.ok) return dropQueued(id, scope);
            return undefined;
          })
          .catch((err: unknown) => failed("enqueue", err));
        return outcome;
      }
      if (!outcome.ok) {
        abandon(id, outcome.errno);
        const blobKey = "blobKey" in outcome ? outcome.blobKey : undefined;
        if (blobKey !== undefined)
          void deps.blobs.take(blobKey).catch(() => null);
        return { ok: false, errno: outcome.errno };
      }
      return outcome;
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Hands back the operation's answer. The promise
     * has existed since it was queued, so an answer that arrives before this call
     * is kept rather than lost; the entry is dropped once it is handed over, and
     * one that is never handed over is dropped at its deadline.
     */
    async awaitResult(id: string): Promise<FileAnswer> {
      const entry = pending.get(id);
      if (entry === undefined) return { ok: false, errno: "EIO" };
      entry.awaited = true;
      if (entry.finished) forget(id);
      return entry.answer;
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Hands the worker up to `capacity` operations
     * within the claim's byte ceiling, at most one per Agent per pass in rotation
     * and passes repeated until the claim is full or a pass finds nothing, waiting
     * on this instance's wake notification and on a two second tick. A store that
     * fails answers an empty claim, which the worker retries like any other drop.
     */
    async take(
      owner: string,
      satellite: string,
      incarnation: string,
      capacity: number,
      waitMs: number,
    ): Promise<FileWorkItem[]> {
      const deadline = now() + waitMs;
      for (;;) {
        let items: FileWorkItem[];
        try {
          items = await drain(owner, satellite, incarnation, capacity);
        } catch (err) {
          failed("take", err);
          return [];
        }
        if (items.length > 0 || capacity <= 0) return items;
        const remaining = deadline - now();
        if (remaining <= 0) return items;
        await waitForWake(owner, satellite, Math.min(POLL_MS, remaining));
      }
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Takes one operation's answer from the worker
     * that claimed it. The record is read first and deleted only by the answer
     * that proves this Satellite and this registration, so an answer for another
     * machine leaves the operation to its own; the deletion is the single win that
     * decrements the Agent's count and resolves the waiting request. An answer past
     * the operation's deadline is dropped: the Agent was already told it failed.
     */
    async settle(owner: string, input: FileResultInput): Promise<void> {
      try {
        const raw = await deps.redis.get(opKey(input.id));
        if (raw === null) return;
        const record = recordOf(raw);
        if (record === null) return;
        if (record.owner !== owner || record.satellite !== input.satellite)
          return;
        if (record.incarnation !== input.incarnation) return;
        if (record.deadline < now()) return;
        if (Number(await deps.redis.del(opKey(input.id))) !== 1) return;

        await deps.bus.publish(
          `satfile:res:${record.holder}`,
          JSON.stringify({
            id: input.id,
            ok: input.ok,
            ...(input.errno === undefined ? {} : { errno: input.errno }),
            ...(input.result === undefined ? {} : { result: input.result }),
            ...(input.data === undefined ? {} : { data: input.data }),
          }),
        );
        /**
         * UNIT_BOUNDARY_DESCRIPTION: The release is detached so a slow store
         * does not hold the answer back, and it is caught because a rejection
         * with no handler ends the process. A release that fails costs nothing
         * permanent: the in-flight counter was given a 120 s expiry when it was
         * last incremented, so it goes by itself rather than shrinking the
         * Satellite's capacity for good.
         */
        void releaseInflight(
          record.owner,
          record.satellite,
          record.agentId,
        ).catch((err: unknown) => failed("settle", err));
        void countAnswered(record, input).catch((err: unknown) =>
          failed("count", err),
        );
      } catch (err) {
        failed("settle", err);
      }
    },

    async seen(agentId: string): Promise<void> {
      await deps.redis.set(
        presenceKey(agentId),
        "1",
        "EX",
        PRESENCE_TTL_SECONDS,
      );
    },

    async isPresent(agentId: string): Promise<boolean> {
      return (await deps.redis.get(presenceKey(agentId))) !== null;
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Ends what the Agent has waiting under one
     * Satellite and marks the grant, so an operation cannot slip past a
     * revocation: the marker outlives the Agent's deadline, the queued ids are
     * deleted with their records, the Agent leaves the rotation, and a waiting
     * request is answered at once rather than at its deadline.
     */
    async revoke(
      owner: string,
      satellite: string,
      agentId: string,
    ): Promise<void> {
      await deps.redis.set(
        revokedKey(owner, satellite, agentId),
        "1",
        "EX",
        REVOKED_TTL_SECONDS,
      );
      const queue = queueKey(owner, satellite, agentId);
      const ids = await deps.redis.lrange(queue, 0, -1);
      if (ids.length > 0) await deps.redis.del(...ids.map(opKey));
      await Promise.allSettled([
        deps.redis.del(queue),
        deps.redis.srem(membersKey(owner, satellite), agentId),
        deps.redis.lrem(rotationKey(owner, satellite), 0, agentId),
      ]);
      await deps.bus.publish(
        END_CHANNEL,
        JSON.stringify({ owner, satellite, agentId, reason: "revoked" }),
      );
    },

    async isRevoked(
      owner: string,
      satellite: string,
      agentId: string,
    ): Promise<boolean> {
      return (
        (await deps.redis.get(revokedKey(owner, satellite, agentId))) !== null
      );
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Grants a Satellite to an Agent again, which has
     * to undo the marker a revocation left — otherwise a grant re-added within the
     * marker's minute would be refused by the very check the revocation wrote.
     */
    async clearRevoked(
      owner: string,
      satellite: string,
      agentId: string,
    ): Promise<void> {
      await deps.redis.del(revokedKey(owner, satellite, agentId));
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Ends every operation queued for a Satellite that
     * has gone offline or is shutting down, for every Agent at once, so no queued
     * operation survives the outage to run after it. The Agent's own in-flight
     * count is left to the release its cleanup performs.
     */
    async satelliteOffline(owner: string, satellite: string): Promise<void> {
      const prefix = `satfile:q:${owner}:${satellite}:`;
      let cursor = "0";
      do {
        const [next, keys] = await deps.redis.scan(
          cursor,
          "MATCH",
          `${prefix}*`,
          "COUNT",
          200,
        );
        cursor = next;
        for (const key of keys) {
          const ids = await deps.redis.lrange(key, 0, -1);
          if (ids.length > 0) await deps.redis.del(...ids.map(opKey));
          await deps.redis.del(key);
        }
      } while (cursor !== "0");
      await Promise.allSettled([
        deps.redis.del(membersKey(owner, satellite)),
        deps.redis.del(rotationKey(owner, satellite)),
      ]);
      await deps.bus.publish(
        END_CHANNEL,
        JSON.stringify({ owner, satellite, reason: "offline" }),
      );
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: Writes the record the file channel keeps — one
     * line per Agent and Satellite and minute, with counts and no path. One
     * replica wins the previous minute's flush key, so a pair is logged once
     * across the install; the winner reads that minute's counters, logs them and
     * deletes them. The minute is the one that just ended, so a full minute is
     * reported rather than the second it started in, and an operation that
     * settles after it was flushed is not counted again, which is the price of a
     * record an Agent's reads can never put a path in.
     */
    async flushSummary(): Promise<void> {
      const minute = Math.floor(now() / 60_000) - 1;
      const won = await deps.redis.set(
        flushKey(minute),
        "1",
        "EX",
        SUMMARY_TTL_SECONDS,
        "NX",
      );
      if (won === null) return;

      const prefix = `satfile:stat:${minute}:`;
      const found = new Set<string>();
      let cursor = "0";
      do {
        const [next, keys] = await deps.redis.scan(
          cursor,
          "MATCH",
          `${prefix}*`,
          "COUNT",
          200,
        );
        cursor = next;
        for (const key of keys) found.add(key);
      } while (cursor !== "0");

      for (const key of found) {
        const rest = key.slice(prefix.length);
        const agentAt = rest.lastIndexOf(":");
        const satelliteAt = rest.lastIndexOf(":", agentAt - 1);
        if (satelliteAt <= 0) continue;
        const owner = rest.slice(0, satelliteAt);
        const satellite = rest.slice(satelliteAt + 1, agentAt);
        const agentId = rest.slice(agentAt + 1);
        const counts = await deps.redis.hgetall(key);
        const opened = openKey(minute, owner, satellite, agentId);
        getLogger().info(
          {
            owner,
            agentId,
            satellite,
            ops: Number(counts.ops ?? 0),
            filesOpened: await deps.redis.scard(opened),
            bytesRead: Number(counts.bytesRead ?? 0),
            bytesWritten: Number(counts.bytesWritten ?? 0),
            created: Number(counts.created ?? 0),
            renamed: Number(counts.renamed ?? 0),
            deleted: Number(counts.deleted ?? 0),
          },
          "satellites.file-channel",
        );
        await deps.redis.del(key, opened);
      }
    },
  };
}

export type SatelliteFileChannel = ReturnType<
  typeof createSatelliteFileChannel
>;
