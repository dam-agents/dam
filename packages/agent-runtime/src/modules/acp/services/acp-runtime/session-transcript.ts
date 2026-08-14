import { rewriteAuthError } from "../../domain/mappers.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";

interface LogEntry {
  seq: number;
  line: string;
  bytes: number;
}

interface SessionLog {
  entries: LogEntry[];
  nextSeq: number;
  totalBytes: number;
  truncated: boolean;
  metadata: unknown;
}

export interface SessionTranscript {
  append(sessionId: string, line: string): void;
  appendEcho(sessionId: string, line: string, originator: ClientChannel): void;
  appendReplay(
    sessionId: string,
    line: string,
    initiator: ClientChannel | null,
  ): void;
  catchUp(channel: ClientChannel, sessionId: string): void;
  advanceToTail(channel: ClientChannel, sessionId: string): void;
  cacheMetadata(sessionId: string, result: unknown): void;
  metadataOf(sessionId: string): unknown;
  forget(sessionId: string): void;
  dropChannel(channel: ClientChannel): void;
  clear(): void;
}

export interface SessionTranscriptDeps {
  logBytesCap: number;
  engagedChannelsFor: (sessionId: string) => Iterable<ClientChannel>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Keeps each session's message history and tracks how
 * far every attached channel has read it, so a channel that joins late or
 * reconnects receives only what it missed. Sequence numbers, the size cap,
 * eviction, and the truncation warning all stay inside.
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
        entries: [],
        nextSeq: 1,
        totalBytes: 0,
        truncated: false,
        metadata: null,
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

  function truncationSentinel(sessionId: string): string {
    return JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: { sessionUpdate: "platform_clipped_replay" },
      },
    });
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

    appendReplay(sessionId, line, initiator) {
      fanOut(sessionId, line, (channel) => channel === initiator);
    },

    catchUp(channel, sessionId) {
      const log = sessionLogs.get(sessionId);
      if (!log) return;
      const current = cursorFor(channel, sessionId);
      if (current === 0 && log.truncated && channel.isOpen()) {
        channel.send(truncationSentinel(sessionId));
      }
      let lastSeq = current;
      for (const entry of log.entries) {
        if (entry.seq <= current) continue;
        if (!channel.isOpen()) return;
        channel.send(rewriteAuthError(entry.line));
        lastSeq = entry.seq;
      }
      if (lastSeq !== current) setCursor(channel, sessionId, lastSeq);
    },

    advanceToTail(channel, sessionId) {
      const entries = sessionLogs.get(sessionId)?.entries ?? [];
      const lastSeq = entries.length > 0 ? entries[entries.length - 1].seq : 0;
      setCursor(channel, sessionId, lastSeq);
    },

    cacheMetadata(sessionId, result) {
      const log = getOrCreateLog(sessionId);
      if (log.metadata === null) log.metadata = result;
    },

    metadataOf(sessionId) {
      return sessionLogs.get(sessionId)?.metadata ?? null;
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
