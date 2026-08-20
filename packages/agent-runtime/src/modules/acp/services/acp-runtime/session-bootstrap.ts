import { match } from "ts-pattern";

import type { JsonRpcId } from "../../domain/frames.js";
import { rewriteAuthError, rewriteCwd } from "../../domain/mappers.js";
import type { ClientChannel } from "../../infrastructure/client-channel.js";
import type { SessionTranscript } from "./session-transcript.js";

type WaiterKind = "load" | "resume";

interface Waiter {
  kind: WaiterKind;
  channel: ClientChannel;
  originalId: JsonRpcId;
}

interface BootstrapState {
  initiatorChannel: ClientChannel | null;
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
  ): boolean;
  trackClientLoad(sessionId: string, initiator: ClientChannel): void;
  onLoadResponse(sessionId: string, frame: unknown): void;
  has(sessionId: string): boolean;
  initiatorOf(sessionId: string): ClientChannel | null;
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
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Answers session/load and session/resume from the
 * Session Transcript when it already holds the session, so the harness is not
 * asked twice for the same history. When the transcript is cold (first attach
 * after a pod restart), at most one session/load per session goes to the
 * harness; every other load or resume for that session parks as a waiter.
 * While the load runs, replayed lines fill the transcript and reach only the
 * channel that initiated a client load — a runtime-initiated load has no
 * initiator and its replay reaches nobody. When the response lands, every
 * parked waiter is served from the transcript, or receives the harness's
 * error if the load failed. session/resume never reaches the harness at all:
 * the runtime answers it here, which hides harnesses that cannot resume.
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

  return {
    requestResume(channel, originalId, sessionId) {
      deps.engage(channel, sessionId);
      if (deps.transcript.metadataOf(sessionId).cached) {
        respondFromLog("resume", channel, originalId, sessionId);
        return;
      }
      const boot = bootstrapBySession.get(sessionId);
      if (boot) {
        boot.waiters.push({ kind: "resume", channel, originalId });
        return;
      }
      bootstrapBySession.set(sessionId, {
        initiatorChannel: null,
        waiters: [{ kind: "resume", channel, originalId }],
      });
      const outboundId = deps.openLoadRoute(sessionId);
      const loadFrame = {
        jsonrpc: "2.0",
        id: outboundId,
        method: "session/load",
        params: { sessionId, cwd: ".", mcpServers: [] },
      };
      deps.sendToAgent(rewriteCwd(loadFrame, deps.workingDir));
    },

    requestLoad(channel, originalId, sessionId) {
      if (deps.transcript.metadataOf(sessionId).cached) {
        respondFromLog("load", channel, originalId, sessionId);
        return true;
      }
      const boot = bootstrapBySession.get(sessionId);
      if (boot) {
        boot.waiters.push({ kind: "load", channel, originalId });
        return true;
      }
      return false;
    },

    trackClientLoad(sessionId, initiator) {
      bootstrapBySession.set(sessionId, {
        initiatorChannel: initiator,
        waiters: [],
      });
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

    initiatorOf(sessionId) {
      return bootstrapBySession.get(sessionId)?.initiatorChannel ?? null;
    },

    dropChannel(channel) {
      for (const [sessionId, state] of bootstrapBySession) {
        if (state.initiatorChannel === channel) {
          bootstrapBySession.delete(sessionId);
          continue;
        }
        state.waiters = state.waiters.filter((w) => w.channel !== channel);
      }
    },

    clear() {
      bootstrapBySession.clear();
    },
  };
}
