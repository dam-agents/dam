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

async function runTurn(
  acp: AcpClient,
  turn: ViewerTurn,
  onSession: () => void,
): Promise<void> {
  const sessions = await acp.listSessions();
  const existing = sessions.find(
    (s) => s.platform?.threadTs === turn.sessionKey,
  );
  if (existing) {
    onSession();
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
      threadTs: turn.sessionKey,
      customTitle: turn.sessionTitle,
    },
    onSession,
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: hands a viewer's prompt to their own Session on
 * the owner's Agent and answers as soon as the Agent is awake, without
 * waiting for the turn. The Session is found again by its key, so a viewer's
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
  const sessionKnown = new Map<string, Promise<void>>();

  function start(turn: ViewerTurn): void {
    const lockKey = `${turn.agentId}\n${turn.sessionKey}`;
    const previous = sessionKnown.get(lockKey) ?? Promise.resolve();
    const known = previous.then(
      () =>
        new Promise<void>((resolve) => {
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
              resolve();
            });
        }),
    );
    sessionKnown.set(lockKey, known);
    void known.then(() => {
      if (sessionKnown.get(lockKey) === known) sessionKnown.delete(lockKey);
    });
  }

  return {
    async deliver(turn): Promise<ViewerPromptOutcome> {
      if ((await deps.spendHold(turn.agentId)) !== null) return "spend-limit";
      try {
        await deps.ensureReady(turn.agentId);
      } catch {
        return "agent-unreachable";
      }
      start(turn);
      return "accepted";
    },
  };
}
