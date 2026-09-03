import type { PlatformReplayTurnMeta } from "api-server-api";
import { match } from "ts-pattern";

import type { JsonRpcId } from "../../domain/frames.js";
import { rewriteAuthError, rewriteCwd } from "../../domain/mappers.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";
import type { HistoryProvider } from "../../infrastructure/history-provider.js";
import type { PlatformUndeliveredPrompt } from "api-server-api";
import type { ReplayClip, SessionTranscript } from "./session-transcript.js";

type WaiterKind = "load" | "resume";

interface Waiter {
  kind: WaiterKind;
  channel: ClientChannel;
  originalId: JsonRpcId;
  tail: boolean;
  loadToken?: string;
}

interface BootstrapState {
  waiters: Waiter[];
  deadline: ReturnType<typeof setTimeout>;
  harnessLoadId: number | null;
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
    opts?: { tail?: boolean; loadToken?: string },
  ): void;
  requestPage(
    channel: ClientChannel,
    originalId: JsonRpcId,
    sessionId: string,
    cursor: string,
    opts?: { loadToken?: string },
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
  loadTimeoutMs: number;
  log(msg: string): void;
  historyProvider?: HistoryProvider;
  onProviderServed(sessionId: string): void;
  harnessLoadOrphaned(sessionId: string): boolean;
  turnInFlight(sessionId: string): boolean;
  undeliveredFor(sessionId: string): PlatformUndeliveredPrompt[];
  onLoadOrphaned(sessionId: string, outboundId: number): void;
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
 * harness's error if the load failed. A cold fill has one deadline
 * (loadTimeoutMs) spanning the provider attempt and any harness fallback:
 * when it fires, every waiter receives a timeout error and the state is
 * cleared. A fill whose harness load was already sent leaves that load
 * orphaned — the harness still owes a response, and its replay carries no
 * request correlation — so the orphan is reported to the runtime, which
 * suppresses the session's frames until it settles. A later request may
 * refill from the provider, which needs no harness, but never sends a second
 * harness load for the same session: two overlapping loads produce frames
 * nothing can attribute. session/resume never reaches the harness
 * at all: the runtime answers it here, which hides harnesses that cannot
 * resume. requestPage serves older transcript ranges for a load that carries a
 * replayBefore cursor; the cursor names one transcript generation, so a cursor
 * minted before a restart or rebuild is refused rather than bootstrapped or
 * served from a renumbered log.
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

  function withReplayMeta(
    value: unknown,
    clip: ReplayClip,
    turn: PlatformReplayTurnMeta | null,
    undelivered: PlatformUndeliveredPrompt[],
  ): unknown {
    const extras: Record<string, unknown> = {};
    if (clip.clipped)
      extras.clipped = clip.older !== undefined ? { older: clip.older } : {};
    if (turn !== null) extras.turn = turn;
    if (undelivered.length > 0) extras.undelivered = undelivered;
    if (Object.keys(extras).length === 0) return value;
    const base =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {};
    const meta =
      typeof base._meta === "object" && base._meta !== null
        ? (base._meta as Record<string, unknown>)
        : {};
    const platform =
      typeof meta.platform === "object" && meta.platform !== null
        ? (meta.platform as Record<string, unknown>)
        : {};
    return {
      ...base,
      _meta: {
        ...meta,
        platform: { ...platform, ...extras },
      },
    };
  }

  function respondFromLog(
    kind: WaiterKind,
    channel: ClientChannel,
    originalId: JsonRpcId,
    sessionId: string,
    tail: boolean,
    loadToken?: string,
  ): void {
    const metadata = deps.transcript.metadataOf(sessionId);
    if (!metadata.cached) {
      throw new Error(
        `bootstrap serve for ${sessionId} without cached metadata`,
      );
    }
    let clip: ReplayClip = { clipped: false };
    match(kind)
      .with("load", () => {
        clip = deps.transcript.catchUp(channel, sessionId, {
          tail,
          replayFor: loadToken,
        });
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
      result: withReplayMeta(
        metadata.value,
        clip,
        kind === "load" ? { inFlight: deps.turnInFlight(sessionId) } : null,
        kind === "load" ? deps.undeliveredFor(sessionId) : [],
      ),
    });
    if (channel.isOpen()) channel.send(rewriteAuthError(response));
  }

  function startHarnessLoad(sessionId: string, state: BootstrapState): void {
    if (deps.harnessLoadOrphaned(sessionId)) {
      deps.log(
        `not loading ${sessionId} from the harness: an earlier load is still unanswered`,
      );
      return;
    }
    const outboundId = deps.openLoadRoute(sessionId);
    state.harnessLoadId = outboundId;
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
    clearTimeout(boot.deadline);
    bootstrapBySession.delete(sessionId);
    for (const waiter of boot.waiters) {
      if (!waiter.channel.isOpen()) continue;
      respondFromLog(
        waiter.kind,
        waiter.channel,
        waiter.originalId,
        sessionId,
        waiter.tail,
        waiter.loadToken,
      );
    }
  }

  function expireFill(sessionId: string, state: BootstrapState): void {
    if (bootstrapBySession.get(sessionId) !== state) return;
    bootstrapBySession.delete(sessionId);
    deps.log(`cold fill of ${sessionId} timed out`);
    for (const waiter of state.waiters) {
      if (!waiter.channel.isOpen()) continue;
      waiter.channel.send(
        rewriteAuthError(
          JSON.stringify({
            jsonrpc: "2.0",
            id: waiter.originalId,
            error: {
              code: -32000,
              message: "the harness did not answer the session load in time",
            },
          }),
        ),
      );
    }
    if (state.harnessLoadId !== null) {
      deps.onLoadOrphaned(sessionId, state.harnessLoadId);
    }
  }

  function park(sessionId: string, waiter: Waiter): void {
    const boot = bootstrapBySession.get(sessionId);
    if (boot) {
      boot.waiters.push(waiter);
      return;
    }
    const state: BootstrapState = {
      waiters: [waiter],
      harnessLoadId: null,
      deadline: setTimeout(
        () => expireFill(sessionId, state),
        deps.loadTimeoutMs,
      ),
    };
    bootstrapBySession.set(sessionId, state);
    const provider = deps.historyProvider;
    if (!provider) {
      startHarnessLoad(sessionId, state);
      return;
    }
    void provider.fetch(sessionId).then((lines) => {
      if (bootstrapBySession.get(sessionId) !== state) return;
      if (lines === null) {
        startHarnessLoad(sessionId, state);
        return;
      }
      serveFromProvider(sessionId, lines);
    });
  }

  return {
    requestResume(channel, originalId, sessionId) {
      deps.engage(channel, sessionId);
      if (deps.transcript.metadataOf(sessionId).cached) {
        respondFromLog("resume", channel, originalId, sessionId, false);
        return;
      }
      park(sessionId, { kind: "resume", channel, originalId, tail: false });
    },

    requestLoad(channel, originalId, sessionId, opts) {
      const tail = opts?.tail ?? false;
      if (deps.transcript.metadataOf(sessionId).cached) {
        respondFromLog(
          "load",
          channel,
          originalId,
          sessionId,
          tail,
          opts?.loadToken,
        );
        return;
      }
      park(sessionId, {
        kind: "load",
        channel,
        originalId,
        tail,
        loadToken: opts?.loadToken,
      });
    },

    requestPage(channel, originalId, sessionId, cursor, opts) {
      const metadata = deps.transcript.metadataOf(sessionId);
      if (metadata.cached) {
        const page = deps.transcript.replayPage(channel, sessionId, cursor, {
          replayFor: opts?.loadToken,
        });
        if (page.ok) {
          const response = JSON.stringify({
            jsonrpc: "2.0",
            id: originalId,
            result: withReplayMeta(metadata.value, page.clip, null, []),
          });
          if (channel.isOpen()) channel.send(rewriteAuthError(response));
          return;
        }
      }
      const error = JSON.stringify({
        jsonrpc: "2.0",
        id: originalId,
        error: {
          code: -32602,
          message: "replay window expired; load the session again",
        },
      });
      if (channel.isOpen()) channel.send(error);
    },

    onLoadResponse(sessionId, frame) {
      const boot = bootstrapBySession.get(sessionId);
      if (!boot) return;
      clearTimeout(boot.deadline);
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
          waiter.tail,
          waiter.loadToken,
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
      for (const state of bootstrapBySession.values()) {
        clearTimeout(state.deadline);
      }
      bootstrapBySession.clear();
    },
  };
}
