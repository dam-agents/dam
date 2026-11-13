import { useStore } from "../../../store.js";
import type { SidebarPanelId } from "../lib/sidebar-panels.js";

export type ChatSectionId = Exclude<SidebarPanelId, "processes">;

export interface ChatSection {
  id: ChatSectionId;
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The sections beside an Agent's conversation that
 * start closed and open from the top bar, in the order the column stacks
 * them: Files and Artifacts, each with whether it is open and the setter that
 * opens or closes it. The column draws from this list and the top bar's
 * toggles are made from it, so a section the column can show always has a
 * toggle that opens it again.
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
