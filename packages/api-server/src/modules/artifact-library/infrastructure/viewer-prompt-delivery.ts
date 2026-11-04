import { SessionType } from "api-server-api";
import {
  AcpSessionLoadError,
  type AcpClient,
  type AcpClientFactory,
} from "../../../core/acp-client.js";
import { getLogger } from "../../../core/logger.js";
import type { ChannelTurnAttendance } from "../../../core/turn-attendance.js";
import type { SpendHoldReason } from "../../spend/index.js";
import type {
  ViewerPromptDelivery,
  ViewerPromptOutcome,
} from "../services/share-bridge-service.js";

interface ViewerTurn {
  agentId: string;
  sessionKey: string;
  sessionTitle: string;
  prompt: string;
}

const SESSION_NAMED_WAIT_MS = 10_000;

async function runTurn(
  acp: AcpClient,
  turn: ViewerTurn,
  onSession: (sessionId: string) => void,
): Promise<void> {
  const sessions = await acp.listSessions();
  const existing = sessions.find(
    (s) => s.platform?.threadTs === turn.sessionKey,
  );
  if (existing) {
    onSession(existing.sessionId);
    try {
      await acp.sendPrompt(turn.prompt, {
        resumeSessionId: existing.sessionId,
      });
      return;
    } catch (err) {
      if (!(err instanceof AcpSessionLoadError)) throw err;
    }
  }
  await acp.sendPrompt(turn.prompt, {
    platformMeta: {
      type: SessionType.Artifact,
      threadTs: turn.sessionKey,
      customTitle: turn.sessionTitle,
    },
    onSession,
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: hands a viewer's prompt to their own Session on
 * the owner's Agent and answers, with the Session's id, as soon as the
 * Agent has named it, without waiting for the turn. The Session is typed `artifact`, and its key names
 * the Artifact it came from; it is found again by that key, so a viewer's
 * later prompts continue it; prompts with the same key wait for the one
 * before to name its Session, so two quick clicks never open two Sessions.
 * The turn counts as a channel turn while it runs: nobody watches it, so a
 * credentialed request it makes is refused instead of held for approval. An
 * Agent at a spend limit or the Spend Ceiling is not woken.
 */
export function createViewerPromptDelivery(deps: {
  makeAcpClient: AcpClientFactory;
  ensureReady: (agentId: string) => Promise<void>;
  spendHold: (agentId: string) => Promise<SpendHoldReason | null>;
  attendance: ChannelTurnAttendance;
}): ViewerPromptDelivery {
  const sessionKnown = new Map<string, Promise<string | null>>();

  function start(turn: ViewerTurn): Promise<string | null> {
    const lockKey = `${turn.agentId}\n${turn.sessionKey}`;
    const previous = sessionKnown.get(lockKey) ?? Promise.resolve(null);
    const known = previous.then(
      () =>
        new Promise<string | null>((resolve) => {
          const release = deps.attendance.openChannelTurn(turn.agentId);
          runTurn(deps.makeAcpClient(turn.agentId), turn, resolve)
            .catch((err: unknown) => {
              getLogger().warn(
                { agentId: turn.agentId, error: String(err) },
                "artifact.viewer_prompt.failed",
              );
            })
            .finally(() => {
              release();
              resolve(null);
            });
        }),
    );
    sessionKnown.set(lockKey, known);
    void known.then(() => {
      if (sessionKnown.get(lockKey) === known) sessionKnown.delete(lockKey);
    });
    return known;
  }

  function named(known: Promise<string | null>): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      known,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SESSION_NAMED_WAIT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  return {
    async deliver(turn): Promise<ViewerPromptOutcome> {
      if ((await deps.spendHold(turn.agentId)) !== null)
        return { ok: false, reason: "spend-limit" };
      try {
        await deps.ensureReady(turn.agentId);
      } catch {
        return { ok: false, reason: "agent-unreachable" };
      }
      return { ok: true, sessionId: await named(start(turn)) };
    },
  };
}
