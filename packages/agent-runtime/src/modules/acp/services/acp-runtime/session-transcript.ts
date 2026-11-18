import { randomUUID } from "node:crypto";

import { rewriteAuthError } from "../../domain/mappers.js";
import { tailStart } from "../../domain/replay-tail.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";
import type { SessionMediaStore } from "../../infrastructure/session-media-store.js";
import { withPlatform } from "../../domain/platform-meta.js";

interface LogEntry {
  seq: number;
  line: string;
  bytes: number;
  binary: boolean;
  media: string[];
}

interface SessionLog {
  generation: string;
  entries: LogEntry[];
  nextSeq: number;
  totalBytes: number;
  truncated: boolean;
  mediaRefs: Map<string, number>;
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
  cacheMetadata(
    sessionId: string,
    result: unknown,
    opts?: { synthetic?: boolean },
  ): void;
  metadataOf(sessionId: string): CachedMetadata;
  lines(sessionId: string): { frames: string[]; truncated: boolean };
  forget(sessionId: string): void;
  sessionCount(): number;
  dropChannel(channel: ClientChannel): void;
  clear(): void;
}

export interface SessionTranscriptDeps {
  logBytesCap: number;
  replayTailEvents: number;
  engagedChannelsFor: (sessionId: string) => Iterable<ClientChannel>;
  media?: SessionMediaStore;
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

const INLINE_BINARY_RE = /"data"\s*:\s*"/;

type MediaBlock = Record<string, unknown> & { type: "image" | "audio" };

function mapMediaBlocks(
  value: unknown,
  visit: (block: MediaBlock) => unknown,
): unknown {
  if (Array.isArray(value))
    return value.map((inner) => mapMediaBlocks(inner, visit));
  if (typeof value !== "object" || value === null) return value;
  const block = value as Record<string, unknown>;
  if (block.type === "image" || block.type === "audio")
    return visit(block as MediaBlock);
  return Object.fromEntries(
    Object.entries(block).map(([key, inner]) => [
      key,
      mapMediaBlocks(inner, visit),
    ]),
  );
}

function rewriteMedia(
  line: string,
  visit: (block: MediaBlock) => unknown,
): string {
  let frame: unknown;
  try {
    frame = JSON.parse(line);
  } catch {
    return line;
  }
  return JSON.stringify(mapMediaBlocks(frame, visit));
}

function placeholderOf(block: MediaBlock): unknown {
  return { type: "text", text: `[${block.type} not kept in history]` };
}

function stripBinary(line: string): string {
  return rewriteMedia(line, (block) =>
    typeof block.data === "string" ? placeholderOf(block) : block,
  );
}

function offloadMedia(
  line: string,
  put: (data: string) => string | null,
): { line: string; keys: string[]; inline: boolean } {
  const keys: string[] = [];
  let inline = false;
  const offloaded = rewriteMedia(line, (block) => {
    if (typeof block.data !== "string") return block;
    const key = put(block.data);
    if (key === null) {
      inline = true;
      return block;
    }
    keys.push(key);
    const { data: _data, ...rest } = block;
    return { ...rest, mediaRef: key };
  });
  return { line: keys.length > 0 ? offloaded : line, keys, inline };
}

function inlineMedia(
  line: string,
  keys: ReadonlySet<string>,
  get: (key: string) => string | null,
): string {
  return rewriteMedia(line, (block) => {
    if (typeof block.mediaRef !== "string" || !keys.has(block.mediaRef))
      return block;
    const data = get(block.mediaRef);
    if (data === null) return placeholderOf(block);
    const { mediaRef: _mediaRef, ...rest } = block;
    return { ...rest, data };
  });
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
 * eviction, and the clip accounting all stay inside. The bytes of an inline
 * image or audio block go to the Session's media store as the entry is
 * appended, and the entry keeps the store's key in their place, so the cap
 * counts text and a large paste neither fills memory nor pushes the text
 * history out; every replay and every read of the lines puts the bytes back
 * from the store, and live fan-out sends the frame as it came. A block whose
 * bytes the store could not keep stays inline, and over the cap the oldest
 * entry still holding inline bytes first has each replaced by a text
 * placeholder, before any whole entry is evicted; a block the store has lost
 * by the time it is replayed shows the same placeholder. A file is dropped
 * once no entry of its Session refers to it, and a forgotten Session takes
 * its folder with it. A fresh viewer that opts
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
 * silently paging from a renumbered position. When a replay carries a
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
        mediaRefs: new Map(),
        metadata: { cached: false },
      };
      sessionLogs.set(sessionId, log);
    }
    return log;
  }

  function keepMedia(
    sessionId: string,
    log: SessionLog,
    line: string,
  ): { line: string; media: string[]; binary: boolean } {
    const media = deps.media;
    if (!INLINE_BINARY_RE.test(line)) return { line, media: [], binary: false };
    if (media === undefined) return { line, media: [], binary: true };
    const kept = offloadMedia(line, (data) => media.put(sessionId, data));
    for (const key of kept.keys)
      log.mediaRefs.set(key, (log.mediaRefs.get(key) ?? 0) + 1);
    return { line: kept.line, media: kept.keys, binary: kept.inline };
  }

  function releaseMedia(
    sessionId: string,
    log: SessionLog,
    entry: LogEntry,
  ): void {
    for (const key of entry.media) {
      const left = (log.mediaRefs.get(key) ?? 1) - 1;
      if (left > 0) {
        log.mediaRefs.set(key, left);
        continue;
      }
      log.mediaRefs.delete(key);
      deps.media?.drop(sessionId, key);
    }
  }

  function lineOf(sessionId: string, entry: LogEntry): string {
    const media = deps.media;
    if (entry.media.length === 0 || media === undefined) return entry.line;
    return inlineMedia(entry.line, new Set(entry.media), (key) =>
      media.get(sessionId, key),
    );
  }

  function appendToLog(sessionId: string, frame: string): number {
    const log = getOrCreateLog(sessionId);
    const { line, media, binary } = keepMedia(sessionId, log, frame);
    const bytes = line.length;
    const seq = log.nextSeq++;
    log.entries.push({ seq, line, bytes, binary, media });
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
      releaseMedia(sessionId, log, evicted);
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
          withPlatformMeta(rewriteAuthError(lineOf(sessionId, entry)), {
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
      return { clipped: log.truncated };
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
      if (first === undefined)
        return { ok: true, clip: { clipped: log.truncated } };
      for (const entry of page) {
        if (!channel.isOpen()) break;
        channel.send(
          withPlatformMeta(rewriteAuthError(lineOf(sessionId, entry)), {
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

    lines(sessionId) {
      const log = sessionLogs.get(sessionId);
      if (!log) return { frames: [], truncated: false };
      return {
        frames: log.entries.map((entry) => lineOf(sessionId, entry)),
        truncated: log.truncated,
      };
    },

    metadataOf(sessionId) {
      return sessionLogs.get(sessionId)?.metadata ?? { cached: false };
    },

    forget(sessionId) {
      if (sessionLogs.delete(sessionId)) deps.media?.forget(sessionId);
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
      deps.media?.clear();
      channelCursors.clear();
    },
  };
}
