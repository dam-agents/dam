import type { ArtifactSendPromptResult } from "api-server-api";
import { useCallback } from "react";
import { match } from "ts-pattern";

import { emitToast } from "../../../lib/toast.js";
import { cachedAgent } from "../../agents/api/queries.js";
import { useOpenSession } from "../../sessions/hooks/use-open-session.js";
import { useSendArtifactPrompt } from "../api/mutations.js";

const SENT_TTL_MS = 10_000;

type Refusal = Extract<ArtifactSendPromptResult, { ok: false }>["reason"];

function refusal(reason: Refusal): string {
  return match(reason)
    .with(
      "spend-limit",
      () =>
        "The agent reached its spend limit for today, so it did not get this.",
    )
    .with(
      "agent-unreachable",
      () => "The agent could not be reached. Try again in a moment.",
    )
    .with(
      "profile-unavailable",
      () =>
        "The model this page is set to use cannot run now, so the agent did not get this. Pick another in the page's Set model.",
    )
    .with("not-allowed", () => "This page can no longer ask the agent.")
    .exhaustive();
}

export function sentNotice(agentName: string | null): string {
  const agent = agentName ?? "the agent";
  return `Sent to ${agent} in a session of its own. Nobody watches that session, so a step that needs your permission is skipped.`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: sends a prompt from an artifact opened outside a
 * chat to the owner's own Session for that page on its publishing Agent. The
 * turn runs without a chat to watch it, so the toast names the agent, says
 * that nobody answers its permission prompts, and opens the Session.
 */
export function useArtifactSessionPrompt(
  artifactId: string | undefined,
): ((prompt: string) => Promise<void>) | undefined {
  const { mutateAsync } = useSendArtifactPrompt();
  const openSession = useOpenSession();
  const send = useCallback(
    async (prompt: string) => {
      if (artifactId === undefined) return;
      const result = await mutateAsync({ artifactId, prompt });
      if (!result.ok) throw new Error(refusal(result.reason));
      const { agentId, sessionId } = result;
      emitToast({
        kind: "success",
        message: sentNotice(cachedAgent(agentId)?.name ?? null),
        ttl: SENT_TTL_MS,
        ...(sessionId !== null && {
          action: {
            label: "Open session",
            onClick: () => openSession(agentId, sessionId),
          },
        }),
      });
    },
    [artifactId, mutateAsync, openSession],
  );
  return artifactId === undefined ? undefined : send;
}
