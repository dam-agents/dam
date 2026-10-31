import type { ArtifactSendPromptResult } from "api-server-api";
import { useCallback } from "react";
import { match } from "ts-pattern";

import { emitToast } from "../../../lib/toast.js";
import { useSendArtifactPrompt } from "../api/mutations.js";

function refusal(result: ArtifactSendPromptResult): string | null {
  if (result.ok) return null;
  return match(result.reason)
    .with(
      "spend-limit",
      () =>
        "The agent reached its spend limit for today, so it did not get this.",
    )
    .with(
      "agent-unreachable",
      () => "The agent could not be reached. Try again in a moment.",
    )
    .with("not-allowed", () => "This page can no longer ask the agent.")
    .exhaustive();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: sends a prompt from an artifact opened outside a
 * chat to the owner's own Session for that page on its publishing Agent. The
 * turn runs without a chat to watch it, so the toast says where to find it.
 */
export function useArtifactSessionPrompt(
  artifactId: string | undefined,
): ((prompt: string) => Promise<void>) | undefined {
  const { mutateAsync } = useSendArtifactPrompt();
  const send = useCallback(
    async (prompt: string) => {
      if (artifactId === undefined) return;
      const reason = refusal(await mutateAsync({ artifactId, prompt }));
      if (reason !== null) throw new Error(reason);
      emitToast({
        kind: "success",
        message:
          "Sent to the agent in a session of its own. Find it in the agent's sessions.",
      });
    },
    [artifactId, mutateAsync],
  );
  return artifactId === undefined ? undefined : send;
}
