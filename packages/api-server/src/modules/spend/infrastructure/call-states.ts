import type { Redis } from "ioredis";
import {
  AMOUNT_FIELDS,
  mapAmounts,
  type CallAmounts,
  type SpendRow,
} from "../domain/ledger.js";
import type { SpendUnit } from "../domain/units.js";

export interface CallMeta {
  readonly agentId: string;
  readonly payer: string;
  readonly ownerSub: string;
  readonly connectionId: string | null;
  readonly providers: readonly string[];
  readonly sessionId: string | null;
  readonly routerCallId?: string | null;
  readonly startedAt: Date;
}

export interface AppliedCall {
  readonly row: SpendRow;
  readonly previous: CallAmounts;
  readonly previousFinal: boolean;
}

export interface CallState {
  readonly meta: CallMeta | null;
  readonly row: SpendRow | null;
  readonly amounts: CallAmounts;
  readonly final: boolean;
}

export interface CallStates {
  started(callId: string, meta: CallMeta): Promise<void>;
  apply(
    callId: string,
    row: SpendRow,
    amounts: CallAmounts,
    final: boolean,
  ): Promise<AppliedCall | null>;
  restore(callId: string, applied: AppliedCall): Promise<void>;
  read(callId: string): Promise<CallState | null>;
  overdue(startedBefore: Date, limit: number): Promise<string[]>;
  release(callId: string, agentId: string | null): Promise<boolean>;
  reclaim(callId: string): Promise<void>;
  forget(callId: string, agentId: string | null): Promise<void>;
  rebook(callId: string, sessionId: string): Promise<void>;
  heard(callId: string): Promise<void>;
  openCount(agentId: string): Promise<number>;
}

const CALL_TTL_SECONDS = 2 * 60 * 60;
const OPEN_CALL_SILENCE_MS = 10_000;
const IN_FLIGHT_KEY = "spend:inflight";
const ROW_FIELDS = [
  "day",
  "payer",
  "ownerSub",
  "connectionId",
  "model",
  "sessionId",
  "callingAgentId",
  "provider",
  "unit",
] as const satisfies readonly (keyof SpendRow)[];

const APPLY_SCRIPT = `
local key = KEYS[1]
local final = ARGV[1]
local previous_final = redis.call('HGET', key, 'final') or '0'
if previous_final == '1' and final ~= '1' then return nil end
local rows, amounts = tonumber(ARGV[3]), tonumber(ARGV[4])
local out = {previous_final}
if not redis.call('HGET', key, 'r_' .. ARGV[5]) then
  for i = 0, rows - 1 do
    redis.call('HSET', key, 'r_' .. ARGV[5 + i * 2], ARGV[6 + i * 2])
  end
end
for i = 0, rows - 1 do
  out[#out + 1] = redis.call('HGET', key, 'r_' .. ARGV[5 + i * 2])
end
local base = 5 + rows * 2
for i = 0, amounts - 1 do
  local field = 'a_' .. ARGV[base + i * 2]
  out[#out + 1] = redis.call('HGET', key, field) or '0'
  redis.call('HSET', key, field, ARGV[base + 1 + i * 2])
end
if final == '1' then redis.call('HSET', key, 'final', '1') end
local now = redis.call('TIME')
redis.call('HSET', key, 'seen', now[1] * 1000 + math.floor(now[2] / 1000))
redis.call('EXPIRE', key, ARGV[2])
return out
`;

const HEARD_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
local now = redis.call('TIME')
redis.call('HSET', KEYS[1], 'seen', now[1] * 1000 + math.floor(now[2] / 1000))
return 1
`;

const OPEN_COUNT_SCRIPT = `
local now = redis.call('TIME')
local since = now[1] * 1000 + math.floor(now[2] / 1000) - tonumber(ARGV[1])
local open = 0
for _, call_id in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  if redis.call('ZSCORE', KEYS[2], call_id) then
    local call = 'spend:call:' .. call_id
    local seen = redis.call('HGET', call, 'seen') or redis.call('HGET', call, 'm_started')
    if seen and tonumber(seen) >= since then open = open + 1 end
  else
    redis.call('SREM', KEYS[1], call_id)
  end
end
return open
`;

const REBOOK_SCRIPT = `
if redis.call('HGET', KEYS[1], 'r_sessionId') == '' then
  redis.call('HSET', KEYS[1], 'r_sessionId', ARGV[1])
end
return 0
`;

const callKey = (callId: string) => `spend:call:${callId}`;
const agentKey = (agentId: string) => `spend:inflight:agent:${agentId}`;

export function createRedisCallStates(redis: Redis): CallStates {
  return {
    async started(callId, meta) {
      const multi = redis.multi();
      if (meta.agentId) {
        multi
          .sadd(agentKey(meta.agentId), callId)
          .expire(agentKey(meta.agentId), CALL_TTL_SECONDS);
      }
      await multi
        .hset(callKey(callId), {
          m_agent: meta.agentId,
          m_payer: meta.payer,
          m_owner: meta.ownerSub,
          m_conn: meta.connectionId ?? "",
          m_providers: meta.providers.join(","),
          m_session: meta.sessionId ?? "",
          m_router_call: meta.routerCallId ?? "",
          m_started: String(meta.startedAt.getTime()),
        })
        .expire(callKey(callId), CALL_TTL_SECONDS)
        .zadd(IN_FLIGHT_KEY, meta.startedAt.getTime(), callId)
        .exec();
    },

    async apply(callId, row, amounts, final) {
      const args = [
        final ? "1" : "0",
        String(CALL_TTL_SECONDS),
        String(ROW_FIELDS.length),
        String(AMOUNT_FIELDS.length),
        ...ROW_FIELDS.flatMap((field) => [field, row[field]]),
        ...AMOUNT_FIELDS.flatMap((field) => [field, String(amounts[field])]),
      ];
      const out = (await redis.eval(
        APPLY_SCRIPT,
        1,
        callKey(callId),
        ...args,
      )) as string[] | null;
      if (!out) return null;
      const [previousFinal, ...rest] = out;
      const stored = rest.slice(0, ROW_FIELDS.length);
      const previous = rest.slice(ROW_FIELDS.length);
      return {
        previousFinal: previousFinal === "1",
        row: rowFrom((field) => stored[ROW_FIELDS.indexOf(field)] ?? ""),
        previous: mapAmounts((field) =>
          Number(previous[AMOUNT_FIELDS.indexOf(field)] ?? 0),
        ),
      };
    },

    async restore(callId, applied) {
      await redis.hset(callKey(callId), {
        final: applied.previousFinal ? "1" : "0",
        ...Object.fromEntries(
          AMOUNT_FIELDS.map((field) => [
            `a_${field}`,
            String(applied.previous[field]),
          ]),
        ),
      });
    },

    async read(callId) {
      const hash = await redis.hgetall(callKey(callId));
      if (Object.keys(hash).length === 0) return null;
      return {
        meta: hash.m_payer
          ? {
              agentId: hash.m_agent ?? "",
              payer: hash.m_payer,
              ownerSub: hash.m_owner ?? "",
              connectionId: hash.m_conn || null,
              providers: (hash.m_providers ?? "").split(",").filter(Boolean),
              sessionId: hash.m_session || null,
              routerCallId: hash.m_router_call || null,
              startedAt: new Date(Number(hash.m_started)),
            }
          : null,
        row: hash.r_day ? rowFrom((field) => hash[`r_${field}`] ?? "") : null,
        amounts: mapAmounts((field) => Number(hash[`a_${field}`] ?? 0)),
        final: hash.final === "1",
      };
    },

    async overdue(startedBefore, limit) {
      return redis.zrangebyscore(
        IN_FLIGHT_KEY,
        0,
        startedBefore.getTime(),
        "LIMIT",
        0,
        limit,
      );
    },

    async release(callId, agentId) {
      const multi = redis.multi().zrem(IN_FLIGHT_KEY, callId);
      if (agentId) multi.srem(agentKey(agentId), callId);
      const out = await multi.exec();
      return out?.[0]?.[1] === 1;
    },

    async reclaim(callId) {
      const started = await redis.hget(callKey(callId), "m_started");
      await redis.zadd(IN_FLIGHT_KEY, Number(started ?? 0), callId);
    },

    async forget(callId, agentId) {
      const multi = redis
        .multi()
        .zrem(IN_FLIGHT_KEY, callId)
        .del(callKey(callId));
      if (agentId) multi.srem(agentKey(agentId), callId);
      await multi.exec();
    },

    async rebook(callId, sessionId) {
      await redis.eval(REBOOK_SCRIPT, 1, callKey(callId), sessionId);
    },

    async heard(callId) {
      await redis.eval(HEARD_SCRIPT, 1, callKey(callId));
    },

    async openCount(agentId) {
      return Number(
        await redis.eval(
          OPEN_COUNT_SCRIPT,
          2,
          agentKey(agentId),
          IN_FLIGHT_KEY,
          String(OPEN_CALL_SILENCE_MS),
        ),
      );
    },
  };
}

function rowFrom(value: (field: keyof SpendRow) => string): SpendRow {
  return {
    day: value("day"),
    payer: value("payer"),
    ownerSub: value("ownerSub"),
    connectionId: value("connectionId"),
    model: value("model"),
    sessionId: value("sessionId"),
    callingAgentId: value("callingAgentId"),
    provider: value("provider"),
    unit: value("unit") as SpendUnit,
  };
}
