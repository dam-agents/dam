import { createHash, randomUUID } from "node:crypto";

import { rewriteAuthError } from "../../domain/mappers.js";
import {
  historyTailStart,
  opensUserTurn,
  tailStart,
} from "../../domain/replay-tail.js";
import { historyIndexOfLogMessage } from "../../domain/rewrite-cut.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";
import { withPlatform } from "../../domain/platform-meta.js";

interface LogEntry {
  seq: number;
  line: string;
  bytes: number;
  binary: boolean;
  dropped: boolean;
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
  { cached: true; value: unknown; synthetic: boolean } | { cached: false };

export interface ReplayClip {
  clipped: boolean;
  older?: string;
}

export type PageReplay = { ok: true; clip: ReplayClip } | { ok: false };

export interface ReplayOpts {
  tail?: boolean;
  replayFor?: string;
  history?: readonly string[];
}

export interface SessionFrames {
  frames: string[];
  truncated: boolean;
  needsHistory: boolean;
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
  catchUpNeedsHistory(
    channel: ClientChannel,
    sessionId: string,
    opts?: { tail?: boolean },
  ): boolean;
  replayPage(
    channel: ClientChannel,
    sessionId: string,
    cursor: string,
    opts?: { replayFor?: string; history?: readonly string[] },
  ): PageReplay;
  pageNeedsHistory(sessionId: string, cursor: string): boolean;
  advanceToTail(channel: ClientChannel, sessionId: string): void;
  cacheMetadata(
    sessionId: string,
    result: unknown,
    opts?: { synthetic?: boolean },
  ): void;
  metadataOf(sessionId: string): CachedMetadata;
  lines(sessionId: string): { frames: string[]; truncated: boolean };
  linesWithMedia(
    sessionId: string,
    opts?: { tail?: number; history?: readonly string[] },
  ): SessionFrames;
  forget(sessionId: string): void;
  sessionCount(): number;
  dropChannel(channel: ClientChannel): void;
  clear(): void;
}

export interface SessionTranscriptDeps {
  logBytesCap: number;
  replayTailEvents: number;
  engagedChannelsFor: (sessionId: string) => Iterable<ClientChannel>;
  olderInHistory: boolean;
}

type PageCursor =
  | { kind: "log"; generation: string; seq: number }
  | { kind: "beforeLog"; generation: string; seq: number }
  | { kind: "history"; generation: string; index: number };

const BEFORE_LOG_MARK = ":before-log";
const HISTORY_MARK = ":history";

function cursorText(cursor: PageCursor): string {
  switch (cursor.kind) {
    case "log":
      return `${cursor.generation}:${cursor.seq}`;
    case "beforeLog":
      return `${cursor.generation}${BEFORE_LOG_MARK}:${cursor.seq}`;
    case "history":
      return `${cursor.generation}${HISTORY_MARK}:${cursor.index}`;
  }
}

function encodePageCursor(cursor: PageCursor): string {
  return Buffer.from(cursorText(cursor), "utf8").toString("base64url");
}

function decodePageCursor(cursor: string): PageCursor | null {
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const at = text.lastIndexOf(":");
  if (at <= 0) return null;
  const n = Number(text.slice(at + 1));
  const head = text.slice(0, at);
  if (head.endsWith(HISTORY_MARK)) {
    if (!Number.isInteger(n) || n <= 0) return null;
    const generation = head.slice(0, -HISTORY_MARK.length);
    return generation ? { kind: "history", generation, index: n } : null;
  }
  if (!Number.isInteger(n) || n <= 0) return null;
  if (head.endsWith(BEFORE_LOG_MARK)) {
    const generation = head.slice(0, -BEFORE_LOG_MARK.length);
    return generation ? { kind: "beforeLog", generation, seq: n } : null;
  }
  return { kind: "log", generation: head, seq: n };
}

const INLINE_BINARY_RE = /"data"\s*:\s*"/;

type MediaBlock = Record<string, unknown> & { type: "image" | "audio" };

interface DroppedMedia {
  sha256: string;
  length: number;
}

function sha256Of(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

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

function parsed(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function rewriteMedia(
  line: string,
  visit: (block: MediaBlock) => unknown,
): string {
  const frame = parsed(line);
  return frame === undefined
    ? line
    : JSON.stringify(mapMediaBlocks(frame, visit));
}

function droppedOf(block: MediaBlock): DroppedMedia | null {
  const dropped = block.dropped as Partial<DroppedMedia> | undefined;
  return typeof dropped?.sha256 === "string" &&
    typeof dropped.length === "number"
    ? { sha256: dropped.sha256, length: dropped.length }
    : null;
}

function dropBinary(line: string): string {
  return rewriteMedia(line, (block) => {
    if (typeof block.data !== "string") return block;
    const { data, ...rest } = block;
    return {
      ...rest,
      dropped: { sha256: sha256Of(data), length: data.length },
    };
  });
}

function droppedIn(lines: readonly string[]): DroppedMedia[] {
  const found: DroppedMedia[] = [];
  for (const line of lines) {
    rewriteMedia(line, (block) => {
      const dropped = droppedOf(block);
      if (dropped) found.push(dropped);
      return block;
    });
  }
  return found;
}

function mediaOfHistory(
  history: readonly string[],
  wanted: readonly DroppedMedia[],
): Map<string, string> {
  const media = new Map<string, string>();
  const lengths = new Set(wanted.map((w) => w.length));
  const hashes = new Set(wanted.map((w) => w.sha256));
  for (const line of history) {
    if (!INLINE_BINARY_RE.test(line)) continue;
    mapMediaBlocks(parsed(line), (block) => {
      const data = block.data;
      if (typeof data !== "string" || !lengths.has(data.length)) return block;
      const sha256 = sha256Of(data);
      if (hashes.has(sha256)) media.set(sha256, data);
      return block;
    });
  }
  return media;
}

function restoreMedia(
  line: string,
  media: ReadonlyMap<string, string>,
): string {
  return rewriteMedia(line, (block) => {
    const dropped = droppedOf(block);
    if (dropped === null) return block;
    const data = media.get(dropped.sha256);
    if (data === undefined)
      return { type: "text", text: `[${block.type} not kept in history]` };
    const { dropped: _dropped, ...rest } = block;
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
 * eviction, and the clip accounting all stay inside. Over the cap, the
 * oldest entry still holding inline image or audio bytes first has each
 * replaced by a reference — the SHA-256 and length of the bytes — and whole
 * entries are evicted only once none is left, so one large paste cannot push
 * the text history out; live fan-out still carries the bytes. What the log
 * no longer holds is read from the harness's own history, which the caller
 * fetches from the session-history provider when catchUpNeedsHistory,
 * pageNeedsHistory or linesWithMedia says a read needs it, and passes in: a
 * referenced block takes the bytes of the history block with the same hash,
 * and a log that evicted entries hands everything before its first whole
 * prompt over to that history, matched there by the prompt's id or text,
 * so the oldest frames the log kept are never sent twice. With no provider,
 * or no match, a referenced block shows as a text placeholder and the log
 * starts at its eviction floor, as the clip reports. A fresh viewer that opts
 * into the tail gets only the newest replayTailEvents entries, moved back so
 * the cut never splits a run of one message's chunks or parts a tool call
 * from its updates, since the client would show half a sentence or drop the
 * updates; a page is cut the same way. catchUp and replayPage report what
 * was cut — and an opaque cursor naming where the cut ends, when the older
 * range is still in the log or in the history — so the caller can put that
 * on the load response. A viewer that does not opt in replays everything the
 * log holds, after the older history when the log evicted any. replayPage
 * serves older ranges on demand without moving any cursor; the cursor embeds
 * the log generation, so a cursor minted before this log was (re)built is
 * refused rather than silently paging from a renumbered position, and one
 * naming a prompt the log has since evicted is refused too. When a replay
 * carries a replayFor token, every replayed frame is stamped with it, letting
 * the requesting client tell its replay apart from live fan-out on the same
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
      dropped: false,
    });
    log.totalBytes += bytes;
    while (log.totalBytes > deps.logBytesCap) {
      const heavy = log.entries.find((entry) => entry.binary);
      if (heavy) {
        heavy.binary = false;
        heavy.dropped = true;
        heavy.line = dropBinary(heavy.line);
        log.totalBytes += heavy.line.length - heavy.bytes;
        heavy.bytes = heavy.line.length;
        continue;
      }
      if (log.entries.length <= 1) break;
      const evicted = log.entries.shift()!;
      log.totalBytes -= evicted.bytes;
      log.truncated = true;
    }
    return seq;
  }

  function promptBoundaryOf(log: SessionLog): number | null {
    if (!deps.olderInHistory || !log.truncated) return null;
    for (let i = 1; i < log.entries.length; i++)
      if (opensUserTurn(log.entries, i)) return i;
    return null;
  }

  function historyIndexOf(
    log: SessionLog,
    boundary: number,
    history: readonly string[],
  ): number | null {
    return historyIndexOfLogMessage(
      history,
      log.entries.map((entry) => entry.line),
      boundary,
    );
  }

  function render(
    entries: readonly LogEntry[],
    history: readonly string[] | undefined,
  ): string[] {
    const lines = entries.map((entry) => entry.line);
    if (!entries.some((entry) => entry.dropped)) return lines;
    const media =
      history === undefined
        ? new Map<string, string>()
        : mediaOfHistory(
            history,
            droppedIn(
              entries.filter((entry) => entry.dropped).map((e) => e.line),
            ),
          );
    return entries.map((entry) =>
      entry.dropped ? restoreMedia(entry.line, media) : entry.line,
    );
  }

  function sendReplay(
    channel: ClientChannel,
    lines: readonly string[],
    replayFor: string | undefined,
  ): number {
    let sent = 0;
    for (const line of lines) {
      if (!channel.isOpen()) break;
      channel.send(withPlatformMeta(rewriteAuthError(line), { replayFor }));
      sent++;
    }
    return sent;
  }

  function historyPage(
    channel: ClientChannel,
    log: SessionLog,
    history: readonly string[],
    end: number,
    replayFor: string | undefined,
  ): PageReplay {
    const older = history.slice(0, end).map((line) => ({ line }));
    const start = tailStart(older, deps.replayTailEvents);
    sendReplay(
      channel,
      older.slice(start).map((frame) => frame.line),
      replayFor,
    );
    return {
      ok: true,
      clip:
        start > 0
          ? {
              clipped: true,
              older: encodePageCursor({
                kind: "history",
                generation: log.generation,
                index: start,
              }),
            }
          : { clipped: false },
    };
  }

  function beforeLogClip(log: SessionLog, boundary: number): ReplayClip {
    return {
      clipped: true,
      older: encodePageCursor({
        kind: "beforeLog",
        generation: log.generation,
        seq: log.entries[boundary]!.seq,
      }),
    };
  }

  function catchUpPlan(
    channel: ClientChannel,
    log: SessionLog,
    sessionId: string,
    tail: boolean,
  ): {
    current: number;
    boundary: number | null;
    pending: LogEntry[];
    capped: boolean;
  } {
    const current = cursorFor(channel, sessionId);
    const boundary = current === 0 ? promptBoundaryOf(log) : null;
    const shown =
      boundary !== null && tail ? log.entries.slice(boundary) : log.entries;
    let pending = shown.filter((entry) => entry.seq > current);
    const start =
      current === 0 && tail ? tailStart(pending, deps.replayTailEvents) : 0;
    const capped = start > 0;
    if (capped) pending = pending.slice(start);
    return { current, boundary, pending, capped };
  }

  function pagePlan(
    log: SessionLog,
    cursor: PageCursor,
  ):
    | { kind: "log"; boundary: number | null; page: LogEntry[]; more: boolean }
    | { kind: "beforeLog"; at: number }
    | { kind: "history"; index: number }
    | null {
    if (cursor.generation !== log.generation) return null;
    if (cursor.kind === "history") {
      return deps.olderInHistory
        ? { kind: "history", index: cursor.index }
        : null;
    }
    if (cursor.kind === "beforeLog") {
      const at = log.entries.findIndex((entry) => entry.seq === cursor.seq);
      return at < 0 ? null : { kind: "beforeLog", at };
    }
    const boundary = promptBoundaryOf(log);
    const floor = boundary === null ? 0 : boundary;
    const older = log.entries
      .slice(floor)
      .filter((entry) => entry.seq < cursor.seq);
    const page = older.slice(tailStart(older, deps.replayTailEvents));
    return {
      kind: "log",
      boundary,
      page,
      more: older.length > page.length,
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

    catchUpNeedsHistory(channel, sessionId, opts) {
      const log = sessionLogs.get(sessionId);
      if (!log || !deps.olderInHistory) return false;
      const tail = opts?.tail ?? false;
      const plan = catchUpPlan(channel, log, sessionId, tail);
      return (
        (!tail && plan.boundary !== null) ||
        plan.pending.some((entry) => entry.dropped)
      );
    },

    catchUp(channel, sessionId, opts) {
      const log = sessionLogs.get(sessionId);
      if (!log) return { clipped: false };
      const tail = opts?.tail ?? false;
      const history = opts?.history;
      const plan = catchUpPlan(channel, log, sessionId, tail);
      const { current, boundary, capped } = plan;
      let pending = plan.pending;
      const handOver =
        !tail && boundary !== null && history !== undefined
          ? historyIndexOf(log, boundary, history)
          : null;
      if (handOver !== null) {
        sendReplay(channel, history!.slice(0, handOver), opts?.replayFor);
        pending = log.entries.slice(boundary!);
      }
      const lines = render(pending, history);
      const sent = sendReplay(channel, lines, opts?.replayFor);
      const lastSent = pending[sent - 1];
      if (lastSent !== undefined) setCursor(channel, sessionId, lastSent.seq);
      if (current !== 0) return { clipped: false };
      if (capped) {
        return {
          clipped: true,
          older: encodePageCursor({
            kind: "log",
            generation: log.generation,
            seq: pending[0]!.seq,
          }),
        };
      }
      if (handOver !== null) return { clipped: false };
      if (tail && boundary !== null) return beforeLogClip(log, boundary);
      return { clipped: log.truncated };
    },

    pageNeedsHistory(sessionId, cursor) {
      const log = sessionLogs.get(sessionId);
      const decoded = decodePageCursor(cursor);
      if (!log || !decoded || !deps.olderInHistory) return false;
      const plan = pagePlan(log, decoded);
      if (plan === null) return false;
      return plan.kind === "log"
        ? plan.page.some((entry) => entry.dropped)
        : true;
    },

    replayPage(channel, sessionId, cursor, opts) {
      const log = sessionLogs.get(sessionId);
      const decoded = decodePageCursor(cursor);
      const plan = log && decoded ? pagePlan(log, decoded) : null;
      if (!log || plan === null) return { ok: false };
      const history = opts?.history;
      const replayFor = opts?.replayFor;
      if (plan.kind === "history") {
        return history === undefined
          ? { ok: false }
          : historyPage(channel, log, history, plan.index, replayFor);
      }
      if (plan.kind === "beforeLog") {
        const handOver =
          history === undefined ? null : historyIndexOf(log, plan.at, history);
        if (handOver !== null)
          return historyPage(channel, log, history!, handOver, replayFor);
        const floor = log.entries.slice(0, plan.at);
        sendReplay(channel, render(floor, history), replayFor);
        return { ok: true, clip: { clipped: log.truncated } };
      }
      const first = plan.page[0];
      sendReplay(channel, render(plan.page, history), replayFor);
      if (first !== undefined && plan.more) {
        return {
          ok: true,
          clip: {
            clipped: true,
            older: encodePageCursor({
              kind: "log",
              generation: log.generation,
              seq: first.seq,
            }),
          },
        };
      }
      if (plan.boundary !== null)
        return { ok: true, clip: beforeLogClip(log, plan.boundary) };
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
        frames: log.entries.map((entry) => entry.line),
        truncated: log.truncated,
      };
    },

    linesWithMedia(sessionId, opts) {
      const log = sessionLogs.get(sessionId);
      if (!log) return { frames: [], truncated: false, needsHistory: false };
      const history = opts?.history;
      if (opts?.tail !== undefined) {
        const start = historyTailStart(
          log.entries.map((entry) => entry.line),
          opts.tail,
        );
        const entries = log.entries.slice(start);
        return {
          frames: render(entries, history),
          truncated: log.truncated || start > 0,
          needsHistory:
            deps.olderInHistory && entries.some((entry) => entry.dropped),
        };
      }
      const boundary = promptBoundaryOf(log);
      const needsHistory =
        boundary !== null ||
        (deps.olderInHistory && log.entries.some((entry) => entry.dropped));
      const handOver =
        boundary !== null && history !== undefined
          ? historyIndexOf(log, boundary, history)
          : null;
      if (handOver !== null) {
        return {
          frames: [
            ...history!.slice(0, handOver),
            ...render(log.entries.slice(boundary!), history),
          ],
          truncated: false,
          needsHistory,
        };
      }
      return {
        frames: render(log.entries, history),
        truncated: log.truncated,
        needsHistory,
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
