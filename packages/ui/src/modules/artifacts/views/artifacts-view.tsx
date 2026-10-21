import { PageHeader } from "@/components/ui/page-header";

import { SidePanelCloseScope } from "../../sessions/components/side-panel-close-button.js";
import { ChatArtifactsPanel } from "../components/chat-artifacts-panel.js";

export function ArtifactsView() {
  return (
    <>
      <PageHeader title="Artifacts" />
      <SidePanelCloseScope value={false}>
        <ChatArtifactsPanel
          agentId={null}
          open
          className="h-[70dvh] overflow-hidden rounded-lg border border-border"
        />
      </SidePanelCloseScope>
    </>
  );
}
