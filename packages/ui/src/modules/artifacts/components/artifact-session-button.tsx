import { Chat } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useFeatures } from "../../features/api/queries.js";
import { useArtifactSession } from "../api/queries.js";

export function ArtifactSessionButton({
  artifact,
  onOpened,
}: {
  artifact: LibraryArtifact;
  onOpened?: () => void;
}) {
  const flagOn = useFeatures().data?.["interactive-artifacts"] ?? false;
  const askable = flagOn && artifact.interactive && artifact.agentId !== null;
  const agentId = askable ? artifact.agentId : null;
  const { data: session } = useArtifactSession(
    agentId,
    askable ? artifact.id : null,
  );
  const openAgentSession = useStore((s) => s.openAgentSession);

  if (!agentId || !session) return null;

  return (
    <Button
      variant="outline"
      size="xs"
      tooltip="Open the conversation this page's requests land in"
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
