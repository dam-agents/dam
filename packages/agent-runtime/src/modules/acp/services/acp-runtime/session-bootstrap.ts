import { match } from "ts-pattern";

import type { JsonRpcId } from "../../domain/frames.js";
import { rewriteAuthError, rewriteCwd } from "../../domain/mappers.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";
import type { HistoryProvider } from "../../infrastructure/history-provider.js";
import type { SessionTranscript } from "./session-transcript.js";

type WaiterKind = "load" | "resume";

interface Waiter {
  kind: WaiterKind;
  channel: ClientChannel;
  originalId: JsonRpcId;
}

interface BootstrapState {
  waiters: Waiter[];
}

export interface SessionBootstrap {
  requestResume(
    channel: ClientChannel,
    originalId: JsonRpcId,
    sessionId: string,
  ): void;
  requestLoad(
    channel: ClientChannel,
    originalId: JsonRpcId,
    sessionId: string,
  ): void;
  requestPage(
    channel: ClientChannel,
    originalId: JsonRpcId,
    sessionId: string,
    beforeSeq: number,
  ): void;
  onLoadResponse(sessionId: string, frame: unknown): void;
  has(sessionId: string): boolean;
  dropChannel(channel: ClientChannel): void;
  clear(): void;
}

export interface SessionBootstrapDeps {
  transcript: SessionTranscript;
  engage(channel: ClientChannel, sessionId: string): void;
  openLoadRoute(sessionId: string): number;
  sendToAgent(frame: unknown): void;
  workingDir: string;
  log(msg: string): void;
  historyProvider?: HistoryProvider;
  onProviderServed(sessionId: string): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Answers session/load and session/resume from the
 * Session Transcript when it already holds the session, so the harness is not
 * asked twice for the same history. When the transcript is cold (first attach
 * after a pod restart), at most one session/load per session goes to the
 * harness; every load or resume for that session parks as a waiter, and the
 * replayed lines fill the transcript without reaching any channel. When the
 * response lands, every parked waiter is served from the transcript — a load
 * gets the transcript's newest tail, a resume gets no replay — or receives the
 * harness's error if the load failed. session/resume never reaches the harness
 * at all: the runtime answers it here, which hides harnesses that cannot
 * resume. requestPage serves older transcript ranges for a load that carries a
 * replayBefore cursor; a cursor from before a pod restart names entries this
 * transcript never held, so a cold page is refused rather than bootstrapped.
 * When the harness image declares a session-history provider, a cold fill
 * prefers it: the provider's replay lines fill the transcript with no harness
 * process at all, the response is synthesized with placeholder metadata, and
 * the session is reported provider-served so the runtime knows the harness
 * itself has not loaded it yet. Any provider failure falls back to the
 * harness load.
 */
export function createSessionBootstrap(
  deps: SessionBootstrapDeps,
): SessionBootstrap {
  const bootstrapBySession = new Map<string, BootstrapState>();

  function respondFromLog(
    kind: WaiterKind,
    channel: ClientChannel,
    originalId: JsonRpcId,
    sessionId: string,
  ): void {
    const metadata = deps.transcript.metadataOf(sessionId);
    if (!metadata.cached) {
      throw new Error(
        `bootstrap serve for ${sessionId} without cached metadata`,
      );
    }
    match(kind)
      .with("load", () => {
        deps.transcript.catchUp(channel, sessionId);
        deps.engage(channel, sessionId);
      })
      .with("resume", () => {
        deps.engage(channel, sessionId);
        deps.transcript.advanceToTail(channel, sessionId);
      })
      .exhaustive((unexpected) => {
        deps.log(`unexpected waiter kind: ${String(unexpected)}`);
      });
    const response = JSON.stringify({
      jsonrpc: "2.0",
      id: originalId,
      result: metadata.value,
    });
    if (channel.isOpen()) channel.send(rewriteAuthError(response));
  }

  function startHarnessLoad(sessionId: string): void {
    const outboundId = deps.openLoadRoute(sessionId);
    const loadFrame = {
      jsonrpc: "2.0",
      id: outboundId,
      method: "session/load",
      params: { sessionId, cwd: ".", mcpServers: [] },
    };
    deps.sendToAgent(rewriteCwd(loadFrame, deps.workingDir));
  }

  function serveFromProvider(sessionId: string, lines: string[]): void {
    const boot = bootstrapBySession.get(sessionId);
    if (!boot) return;
    for (const line of lines) deps.transcript.appendReplay(sessionId, line);
    deps.transcript.cacheMetadata(
      sessionId,
      { sessionId, modes: null, configOptions: null },
      { synthetic: true },
    );
    deps.onProviderServed(sessionId);
    bootstrapBySession.delete(sessionId);
    for (const waiter of boot.waiters) {
      if (!waiter.channel.isOpen()) continue;
      respondFromLog(waiter.kind, waiter.channel, waiter.originalId, sessionId);
    }
  }

  function park(sessionId: string, waiter: Waiter): void {
    const boot = bootstrapBySession.get(sessionId);
    if (boot) {
      boot.waiters.push(waiter);
      return;
    }
    bootstrapBySession.set(sessionId, { waiters: [waiter] });
    const provider = deps.historyProvider;
    if (!provider) {
      startHarnessLoad(sessionId);
      return;
    }
    void provider.fetch(sessionId).then((lines) => {
      if (!bootstrapBySession.has(sessionId)) return;
      if (lines === null) {
        startHarnessLoad(sessionId);
        return;
      }
      serveFromProvider(sessionId, lines);
    });
  }

  return {
    requestResume(channel, originalId, sessionId) {
      deps.engage(channel, sessionId);
      if (deps.transcript.metadataOf(sessionId).cached) {
        respondFromLog("resume", channel, originalId, sessionId);
        return;
      }
      park(sessionId, { kind: "resume", channel, originalId });
    },

    requestLoad(channel, originalId, sessionId) {
      if (deps.transcript.metadataOf(sessionId).cached) {
        respondFromLog("load", channel, originalId, sessionId);
        return;
      }
      park(sessionId, { kind: "load", channel, originalId });
    },

    requestPage(channel, originalId, sessionId, beforeSeq) {
      const metadata = deps.transcript.metadataOf(sessionId);
      if (!metadata.cached) {
        const error = JSON.stringify({
          jsonrpc: "2.0",
          id: originalId,
          error: {
            code: -32602,
            message: "replay window expired; load the session again",
          },
        });
        if (channel.isOpen()) channel.send(error);
        return;
      }
      deps.transcript.replayPage(channel, sessionId, beforeSeq);
      const response = JSON.stringify({
        jsonrpc: "2.0",
        id: originalId,
        result: metadata.value,
      });
      if (channel.isOpen()) channel.send(rewriteAuthError(response));
    },

    onLoadResponse(sessionId, frame) {
      const boot = bootstrapBySession.get(sessionId);
      if (!boot) return;
      bootstrapBySession.delete(sessionId);
      const loadFailed = !deps.transcript.metadataOf(sessionId).cached;
      for (const waiter of boot.waiters) {
        if (!waiter.channel.isOpen()) continue;
        if (loadFailed) {
          const out = JSON.stringify({
            ...(frame as object),
            id: waiter.originalId,
          });
          waiter.channel.send(rewriteAuthError(out));
          continue;
        }
        respondFromLog(
          waiter.kind,
          waiter.channel,
          waiter.originalId,
          sessionId,
        );
      }
    },

    has(sessionId) {
      return bootstrapBySession.has(sessionId);
    },

    dropChannel(channel) {
      for (const state of bootstrapBySession.values()) {
        state.waiters = state.waiters.filter((w) => w.channel !== channel);
      }
    },

    clear() {
      bootstrapBySession.clear();
    },
  };
}
