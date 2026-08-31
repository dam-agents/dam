import { Chat } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useFeatures } from "../../features/api/queries.js";
import { useArtifactSession } from "../api/queries.js";

function tooltipFor(title: string | null): string {
  return title === null
    ? "This page asks in a conversation of yours — open it"
    : `This page asks in "${title}" — open it`;
}

export function ArtifactSessionButton({
  artifact,
  onOpened,
}: {
  artifact: LibraryArtifact;
  onOpened?: () => void;
}) {
  const flagOn = useFeatures().data?.["interactive-artifacts"] ?? false;
  const askable = flagOn && artifact.interactive && artifact.agentId !== null;
  const { data: session } = useArtifactSession(askable ? artifact : null);
  const openAgentSession = useStore((s) => s.openAgentSession);

  const agentId = artifact.agentId;
  if (!askable || agentId === null || !session) return null;

  return (
    <Button
      variant="outline"
      size="xs"
      tooltip={tooltipFor(session.title ?? null)}
      onClick={() => {
        openAgentSession(agentId, session.sessionId);
        onOpened?.();
      }}
    >
      <Chat size={14} />
      Session
    </Button>
  );
}
