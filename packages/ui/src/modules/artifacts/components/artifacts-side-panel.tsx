import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { SidePanelShell } from "../../sessions/components/side-panel-shell.js";
import type { SidePanelTab } from "../../sessions/lib/side-panel.js";
import { ChatArtifactsPanel } from "./chat-artifacts-panel.js";
import { DockedArtifactPanel } from "./docked-artifact-panel.js";

const AGENT_TABS: ReadonlySet<SidePanelTab> = new Set([
  "files",
  "changes",
  "browser",
  "processes",
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: The side panel on every page outside an Agent's
 * chat. With no Agent in view, only the Artifacts tab exists: it lists the
 * whole library and docks the artifact it opens, without the interactive
 * bridge, because no chat is open to receive a prompt.
 */
export function ArtifactsSidePanel({ children }: { children: ReactNode }) {
  const openArtifactId = useStore((s) => s.openArtifactId);
  const artifactDirty = useStore((s) => s.openArtifactDirty);
  const sidePanelTab = useStore((s) => s.sidePanelTab);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);

  const activeTab = sidePanelTab === "artifacts" ? sidePanelTab : null;
  const dockedShown = openArtifactId !== null && activeTab !== null;

  return (
    <SidePanelShell
      mainClassName="z-content"
      activeTab={activeTab}
      hiddenTabs={AGENT_TABS}
      onSelectTab={() => setSidePanelTab(activeTab ? null : "artifacts")}
      dockedShown={dockedShown}
      dockedKept={openArtifactId !== null && (dockedShown || artifactDirty)}
      mobileTitle="Artifacts"
      mobileBackLabel="Close artifacts"
      panel={
        activeTab && (
          <ChatArtifactsPanel
            agentId={null}
            open
            className={cn("flex-1", dockedShown && "hidden")}
          />
        )
      }
      dock={
        openArtifactId && (
          <DockedArtifactPanel key={openArtifactId} agentId={null} />
        )
      }
    >
      {children}
    </SidePanelShell>
  );
}
