import { randomUUID } from "node:crypto";

import { rewriteAuthError } from "../../domain/mappers.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";

interface LogEntry {
  seq: number;
  line: string;
  bytes: number;
}

interface SessionLog {
  generation: string;
  entries: LogEntry[];
  nextSeq: number;
  totalBytes: number;
  truncated: boolean;
  metadata: CachedMetadata;
}

export type CachedMetadata =
  | { cached: true; value: unknown; synthetic: boolean }
  | { cached: false };

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
  append(sessionId: string, line: string): void;
  appendEcho(sessionId: string, line: string, originator: ClientChannel): void;
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
  cacheMetadata(
    sessionId: string,
    result: unknown,
    opts?: { synthetic?: boolean },
  ): void;
  metadataOf(sessionId: string): CachedMetadata;
  bytesOf(sessionId: string): number;
  forget(sessionId: string): void;
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

function stampReplayFor(line: string, token: string | undefined): string {
  if (token === undefined) return line;
  let frame: unknown;
  try {
    frame = JSON.parse(line);
  } catch {
    return line;
  }
  if (typeof frame !== "object" || frame === null) return line;
  const f = frame as Record<string, unknown>;
  const params =
    typeof f.params === "object" && f.params !== null
      ? (f.params as Record<string, unknown>)
      : {};
  const meta =
    typeof params._meta === "object" && params._meta !== null
      ? (params._meta as Record<string, unknown>)
      : {};
  const platform =
    typeof meta.platform === "object" && meta.platform !== null
      ? (meta.platform as Record<string, unknown>)
      : {};
  return JSON.stringify({
    ...f,
    params: {
      ...params,
      _meta: { ...meta, platform: { ...platform, replayFor: token } },
    },
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Keeps each session's message history and tracks how
 * far every attached channel has read it, so a channel that joins late or
 * reconnects receives only what it missed. Sequence numbers, the size cap,
 * eviction, and the clip accounting all stay inside. A fresh viewer that opts
 * into the tail gets only the newest replayTailEvents entries; catchUp and
 * replayPage report what was cut — and an opaque cursor naming where the cut
 * ends, when the older range is still in the log — so the caller can put that
 * on the load response. A viewer that does not opt in replays everything the
 * log holds, clipped only by eviction. replayPage serves older ranges on
 * demand without moving any cursor; the cursor embeds the log generation, so
 * a cursor minted before this log was (re)built is refused rather than
 * silently paging from a renumbered position. When a replay carries a
 * replayFor token, every replayed frame is stamped with it, letting the
 * requesting client tell its replay apart from live fan-out on the same
 * connection.
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
    log.entries.push({ seq, line, bytes });
    log.totalBytes += bytes;
    while (log.totalBytes > deps.logBytesCap && log.entries.length > 1) {
      const evicted = log.entries.shift()!;
      log.totalBytes -= evicted.bytes;
      log.truncated = true;
    }
    return seq;
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
    append(sessionId, line) {
      fanOut(sessionId, line, () => true);
    },

    appendEcho(sessionId, line, originator) {
      fanOut(sessionId, line, (channel) => channel !== originator);
    },

    appendReplay(sessionId, line) {
      fanOut(sessionId, line, () => false);
    },

    catchUp(channel, sessionId, opts) {
      const log = sessionLogs.get(sessionId);
      if (!log) return { clipped: false };
      const current = cursorFor(channel, sessionId);
      let pending = log.entries.filter((entry) => entry.seq > current);
      const capped =
        current === 0 &&
        (opts?.tail ?? false) &&
        pending.length > deps.replayTailEvents;
      if (capped) pending = pending.slice(-deps.replayTailEvents);
      let lastSeq = current;
      for (const entry of pending) {
        if (!channel.isOpen()) break;
        channel.send(
          stampReplayFor(rewriteAuthError(entry.line), opts?.replayFor),
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
      return { clipped: log.truncated };
    },

    replayPage(channel, sessionId, cursor, opts) {
      const log = sessionLogs.get(sessionId);
      const decoded = decodePageCursor(cursor);
      if (!log || !decoded || decoded.generation !== log.generation) {
        return { ok: false };
      }
      const older = log.entries.filter((entry) => entry.seq < decoded.seq);
      const page = older.slice(-deps.replayTailEvents);
      const first = page[0];
      if (first === undefined)
        return { ok: true, clip: { clipped: log.truncated } };
      for (const entry of page) {
        if (!channel.isOpen()) break;
        channel.send(
          stampReplayFor(rewriteAuthError(entry.line), opts?.replayFor),
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
      return { ok: true, clip: { clipped: log.truncated } };
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

    metadataOf(sessionId) {
      return sessionLogs.get(sessionId)?.metadata ?? { cached: false };
    },

    bytesOf(sessionId) {
      return sessionLogs.get(sessionId)?.totalBytes ?? 0;
    },

    forget(sessionId) {
      sessionLogs.delete(sessionId);
      for (const cursors of channelCursors.values()) cursors.delete(sessionId);
    },

    dropChannel(channel) {
      channelCursors.delete(channel);
    },

    clear() {
      sessionLogs.clear();
      channelCursors.clear();
    },
  };
}
