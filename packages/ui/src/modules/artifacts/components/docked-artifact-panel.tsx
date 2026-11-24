import { useStore } from "../../../store.js";
import { SidePanelCloseButton } from "../../sessions/components/side-panel-close-button.js";
import { ArtifactPanel } from "./artifact-panel.js";

interface Props {
  agentId: string | null;
  onSendPrompt?: (prompt: string) => Promise<void>;
}

export function DockedArtifactPanel({ agentId, onSendPrompt }: Props) {
  const openArtifactId = useStore((s) =>
    s.dock?.kind === "artifact" ? s.dock.id : null,
  );
  const setDock = useStore((s) => s.setDock);
  const confirmDockDiscard = useStore((s) => s.confirmDockDiscard);

  if (!openArtifactId) return null;

  return (
    <ArtifactPanel
      artifactId={openArtifactId}
      agentId={agentId}
      onSendPrompt={onSendPrompt}
      onBack={() =>
        void confirmDockDiscard().then((discard) => {
          if (discard) setDock(null);
        })
      }
      close={<SidePanelCloseButton />}
    />
  );
}
