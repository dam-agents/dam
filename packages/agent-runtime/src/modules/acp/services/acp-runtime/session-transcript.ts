import { randomUUID } from "node:crypto";

import { rewriteAuthError } from "../../domain/mappers.js";
import { tailStart } from "../../domain/replay-tail.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";
import { withPlatform } from "../../domain/platform-meta.js";

interface LogEntry {
  seq: number;
  line: string;
  bytes: number;
  binary: boolean;
}

interface SessionLog {
  generation: string;
  entries: LogEntry[];
  nextSeq: number;
  totalBytes: number;
  truncated: boolean;
  before: string | null;
  metadata: CachedMetadata;
}

export type CachedMetadata =
  { cached: true; value: unknown; synthetic: boolean } | { cached: false };

export interface ReplayClip {
  clipped: boolean;
  older?: string;
}

export type PageReplay = { ok: true; clip: ReplayClip } | { ok: false };

export interface ReplayOpts {
  tail?: boolean;
  replayFor?: string;
}

export interface SessionTranscript {
  append(sessionId: string, line: string, turnId?: string | null): void;
  appendEcho(
    sessionId: string,
    line: string,
    originator: ClientChannel | null,
  ): void;
  appendReplay(sessionId: string, line: string): void;
  catchUp(
    channel: ClientChannel,
    sessionId: string,
    opts?: ReplayOpts,
  ): ReplayClip;
  replayPage(
    channel: ClientChannel,
    sessionId: string,
    cursor: string,
    opts?: { replayFor?: string },
  ): PageReplay;
  advanceToTail(channel: ClientChannel, sessionId: string): void;
  continuesBefore(sessionId: string, before: string): void;
  historyStart(sessionId: string): string | null;
  historyBefore(sessionId: string, cursor: string): string | null;
  historyCursor(sessionId: string, before: string): string | null;
  replayLines(
    channel: ClientChannel,
    lines: readonly string[],
    opts?: { replayFor?: string },
  ): void;
  cacheMetadata(
    sessionId: string,
    result: unknown,
    opts?: { synthetic?: boolean },
  ): void;
  metadataOf(sessionId: string): CachedMetadata;
  lines(sessionId: string): {
    frames: string[];
    truncated: boolean;
    partial: boolean;
  };
  forget(sessionId: string): void;
  sessionCount(): number;
  dropChannel(channel: ClientChannel): void;
  clear(): void;
}

export interface SessionTranscriptDeps {
  logBytesCap: number;
  replayTailEvents: number;
  engagedChannelsFor: (sessionId: string) => Iterable<ClientChannel>;
}

function encodePageCursor(generation: string, seq: number): string {
  return Buffer.from(`${generation}:${seq}`, "utf8").toString("base64url");
}

const HISTORY_MARK = ":history:";

function encodeHistoryCursor(generation: string, before: string): string {
  return Buffer.from(`${generation}${HISTORY_MARK}${before}`, "utf8").toString(
    "base64url",
  );
}

function decodePageCursor(
  cursor: string,
): { generation: string; seq: number } | null {
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const at = text.lastIndexOf(":");
  if (at <= 0) return null;
  const seq = Number(text.slice(at + 1));
  if (!Number.isInteger(seq) || seq <= 0) return null;
  return { generation: text.slice(0, at), seq };
}

const INLINE_BINARY_RE = /"data"\s*:\s*"/;

function withoutBinary(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutBinary);
  if (typeof value !== "object" || value === null) return value;
  const block = value as Record<string, unknown>;
  if (
    (block.type === "image" || block.type === "audio") &&
    typeof block.data === "string"
  ) {
    return { type: "text", text: `[${block.type} not kept in history]` };
  }
  return Object.fromEntries(
    Object.entries(block).map(([key, inner]) => [key, withoutBinary(inner)]),
  );
}

function stripBinary(line: string): string {
  try {
    return JSON.stringify(withoutBinary(JSON.parse(line)));
  } catch {
    return line;
  }
}

function withPlatformMeta(
  line: string,
  patch: Record<string, string | undefined>,
): string {
  if (Object.values(patch).every((value) => value === undefined)) return line;
  let frame: unknown;
  try {
    frame = JSON.parse(line);
  } catch {
    return line;
  }
  if (typeof frame !== "object" || frame === null) return line;
  return JSON.stringify(
    withPlatform(frame as Record<string, unknown>, (platform) => ({
      ...platform,
      ...patch,
    })),
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Keeps each session's message history and tracks how
 * far every attached channel has read it, so a channel that joins late or
 * reconnects receives only what it missed. Sequence numbers, the size cap,
 * eviction, and the clip accounting all stay inside. Over the cap, the
 * oldest entry still holding inline image or audio bytes first has each
 * replaced by a text placeholder, and whole entries are evicted only once
 * none is left, so one large paste cannot push the text history out; live
 * fan-out still carries the bytes. A fresh viewer that opts
 * into the tail gets only the newest replayTailEvents entries, moved back so
 * the cut never splits a run of one message's chunks or parts a tool call
 * from its updates, since the client would show half a sentence or drop the
 * updates; a page is cut the same way. catchUp and replayPage report what
 * was cut — and an opaque cursor naming where the cut ends, when the older
 * range is still in the log — so the caller can put that on the load
 * response. A viewer that does not opt in replays everything the
 * log holds, clipped only by eviction. replayPage serves older ranges on
 * demand without moving any cursor; the cursor embeds the log generation, so
 * a cursor minted before this log was (re)built is refused rather than
 * silently paging from a renumbered position. A log filled from the newest
 * part of the harness's own history continues before its first entry in
 * that history: the cut that reaches the log's start carries a history
 * cursor instead, which the caller pages from the history provider, until an
 * eviction drops the log's start and with it the continuity. When a replay carries a
 * replayFor token, every replayed frame is stamped with it, letting the
 * requesting client tell its replay apart from live fan-out on the same
 * connection. Every live entry is stamped with the wall-clock time it was
 * appended; a replayed entry keeps whatever time its source supplied and is
 * never given one here.
 */
export function createSessionTranscript(
  deps: SessionTranscriptDeps,
): SessionTranscript {
  const sessionLogs = new Map<string, SessionLog>();
  const channelCursors = new Map<ClientChannel, Map<string, number>>();

  function getOrCreateLog(sessionId: string): SessionLog {
    let log = sessionLogs.get(sessionId);
    if (!log) {
      log = {
        generation: randomUUID(),
        entries: [],
        nextSeq: 1,
        totalBytes: 0,
        truncated: false,
        before: null,
        metadata: { cached: false },
      };
      sessionLogs.set(sessionId, log);
    }
    return log;
  }

  function appendToLog(sessionId: string, line: string): number {
    const log = getOrCreateLog(sessionId);
    const bytes = line.length;
    const seq = log.nextSeq++;
    log.entries.push({
      seq,
      line,
      bytes,
      binary: INLINE_BINARY_RE.test(line),
    });
    log.totalBytes += bytes;
    while (log.totalBytes > deps.logBytesCap) {
      const heavy = log.entries.find((entry) => entry.binary);
      if (heavy) {
        heavy.binary = false;
        heavy.line = stripBinary(heavy.line);
        log.totalBytes += heavy.line.length - heavy.bytes;
        heavy.bytes = heavy.line.length;
        continue;
      }
      if (log.entries.length <= 1) break;
      const evicted = log.entries.shift()!;
      log.totalBytes -= evicted.bytes;
      log.truncated = true;
      log.before = null;
    }
    return seq;
  }

  function olderThanLog(log: SessionLog): ReplayClip {
    return log.before === null
      ? { clipped: log.truncated }
      : {
          clipped: true,
          older: encodeHistoryCursor(log.generation, log.before),
        };
  }

  function cursorFor(channel: ClientChannel, sessionId: string): number {
    const map = channelCursors.get(channel);
    return map?.get(sessionId) ?? 0;
  }

  function setCursor(
    channel: ClientChannel,
    sessionId: string,
    seq: number,
  ): void {
    let map = channelCursors.get(channel);
    if (!map) {
      map = new Map();
      channelCursors.set(channel, map);
    }
    map.set(sessionId, seq);
  }

  function fanOut(
    sessionId: string,
    line: string,
    shouldSend: (channel: ClientChannel) => boolean,
  ): void {
    const seq = appendToLog(sessionId, line);
    const out = rewriteAuthError(line);
    for (const channel of deps.engagedChannelsFor(sessionId)) {
      if (!channel.isOpen()) continue;
      if (cursorFor(channel, sessionId) >= seq) continue;
      if (shouldSend(channel)) channel.send(out);
      setCursor(channel, sessionId, seq);
    }
  }

  return {
    append(sessionId, line, turnId) {
      fanOut(
        sessionId,
        withPlatformMeta(line, {
          at: new Date().toISOString(),
          turnId: turnId ?? undefined,
        }),
        () => true,
      );
    },

    appendEcho(sessionId, line, originator) {
      fanOut(
        sessionId,
        withPlatformMeta(line, { at: new Date().toISOString() }),
        (channel) => channel !== originator,
      );
    },

    appendReplay(sessionId, line) {
      fanOut(sessionId, line, () => false);
    },

    catchUp(channel, sessionId, opts) {
      const log = sessionLogs.get(sessionId);
      if (!log) return { clipped: false };
      const current = cursorFor(channel, sessionId);
      let pending = log.entries.filter((entry) => entry.seq > current);
      const start =
        current === 0 && (opts?.tail ?? false)
          ? tailStart(pending, deps.replayTailEvents)
          : 0;
      const capped = start > 0;
      if (capped) pending = pending.slice(start);
      let lastSeq = current;
      for (const entry of pending) {
        if (!channel.isOpen()) break;
        channel.send(
          withPlatformMeta(rewriteAuthError(entry.line), {
            replayFor: opts?.replayFor,
          }),
        );
        lastSeq = entry.seq;
      }
      if (lastSeq !== current) setCursor(channel, sessionId, lastSeq);
      if (current !== 0) return { clipped: false };
      if (capped) {
        return {
          clipped: true,
          older: encodePageCursor(log.generation, pending[0]!.seq),
        };
      }
      return olderThanLog(log);
    },

    replayPage(channel, sessionId, cursor, opts) {
      const log = sessionLogs.get(sessionId);
      const decoded = decodePageCursor(cursor);
      if (!log || !decoded || decoded.generation !== log.generation) {
        return { ok: false };
      }
      const older = log.entries.filter((entry) => entry.seq < decoded.seq);
      const page = older.slice(tailStart(older, deps.replayTailEvents));
      const first = page[0];
      if (first === undefined) return { ok: true, clip: olderThanLog(log) };
      for (const entry of page) {
        if (!channel.isOpen()) break;
        channel.send(
          withPlatformMeta(rewriteAuthError(entry.line), {
            replayFor: opts?.replayFor,
          }),
        );
      }
      if (older.length > page.length) {
        return {
          ok: true,
          clip: {
            clipped: true,
            older: encodePageCursor(log.generation, first.seq),
          },
        };
      }
      return { ok: true, clip: olderThanLog(log) };
    },

    continuesBefore(sessionId, before) {
      const log = sessionLogs.get(sessionId);
      if (log && !log.truncated) log.before = before;
    },

    historyStart(sessionId) {
      return sessionLogs.get(sessionId)?.before ?? null;
    },

    historyBefore(sessionId, cursor) {
      const log = sessionLogs.get(sessionId);
      if (!log) return null;
      const text = Buffer.from(cursor, "base64url").toString("utf8");
      const prefix = `${log.generation}${HISTORY_MARK}`;
      return text.startsWith(prefix) && text.length > prefix.length
        ? text.slice(prefix.length)
        : null;
    },

    historyCursor(sessionId, before) {
      const log = sessionLogs.get(sessionId);
      return log ? encodeHistoryCursor(log.generation, before) : null;
    },

    replayLines(channel, lines, opts) {
      for (const line of lines) {
        if (!channel.isOpen()) break;
        channel.send(
          withPlatformMeta(rewriteAuthError(line), {
            replayFor: opts?.replayFor,
          }),
        );
      }
    },

    advanceToTail(channel, sessionId) {
      const entries = sessionLogs.get(sessionId)?.entries ?? [];
      const lastSeq = entries.length > 0 ? entries[entries.length - 1].seq : 0;
      setCursor(channel, sessionId, lastSeq);
    },

    cacheMetadata(sessionId, result, opts) {
      const log = getOrCreateLog(sessionId);
      const synthetic = opts?.synthetic ?? false;
      const replaceable = !log.metadata.cached || log.metadata.synthetic;
      if (replaceable && !(log.metadata.cached && synthetic)) {
        log.metadata = { cached: true, value: result, synthetic };
      }
    },

    lines(sessionId) {
      const log = sessionLogs.get(sessionId);
      if (!log) return { frames: [], truncated: false, partial: false };
      return {
        frames: log.entries.map((entry) => entry.line),
        truncated: log.truncated,
        partial: log.before !== null,
      };
    },

    metadataOf(sessionId) {
      return sessionLogs.get(sessionId)?.metadata ?? { cached: false };
    },

    forget(sessionId) {
      sessionLogs.delete(sessionId);
      for (const cursors of channelCursors.values()) cursors.delete(sessionId);
    },

    dropChannel(channel) {
      channelCursors.delete(channel);
    },

    sessionCount() {
      return sessionLogs.size;
    },

    clear() {
      sessionLogs.clear();
      channelCursors.clear();
    },
  };
}
