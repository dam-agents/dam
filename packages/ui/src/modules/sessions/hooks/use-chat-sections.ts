import { useStore } from "../../../store.js";
import type { SidebarPanelId } from "../lib/sidebar-panels.js";

export type ChatSectionId = Exclude<SidebarPanelId, "processes">;

export interface ChatSection {
  id: ChatSectionId;
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The sections beside an Agent's conversation, as
 * the design's chat refresh draws them: Files and Artifacts, in the order the
 * column stacks them, each with whether it is open and the setter that opens
 * or closes it. The column draws from this list and the agent menu's items are
 * made from it, so a section closed with its X always opens again.
 */
export function useChatSections(): ChatSection[] {
  const filesOpen = useStore((s) => s.filesSectionOpen);
  const setFilesOpen = useStore((s) => s.setFilesSectionOpen);
  const artifactsOpen = useStore((s) => s.artifactsSectionOpen);
  const setArtifactsOpen = useStore((s) => s.setArtifactsSectionOpen);
  return [
    { id: "files", open: filesOpen, setOpen: setFilesOpen },
    { id: "artifacts", open: artifactsOpen, setOpen: setArtifactsOpen },
  ];
}
