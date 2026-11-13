import { useStore } from "../../../store.js";
import type { SidebarPanelId } from "../lib/sidebar-panels.js";

export interface ChatSection {
  id: SidebarPanelId;
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The sections beside an Agent's conversation, in
 * the order the column stacks them: Files, Artifacts, and Processes when the
 * Agent's processes are on, each with whether it is open and the setter that
 * opens or closes it. The column draws from this list and the top bar's
 * section toggles are made from it, so a section the column can show always
 * has a toggle that opens it again.
 */
export function useChatSections(processesEnabled: boolean): ChatSection[] {
  const filesOpen = useStore((s) => s.filesSectionOpen);
  const setFilesOpen = useStore((s) => s.setFilesSectionOpen);
  const artifactsOpen = useStore((s) => s.artifactsSectionOpen);
  const setArtifactsOpen = useStore((s) => s.setArtifactsSectionOpen);
  const processesOpen = useStore((s) => s.processesSectionOpen);
  const setProcessesOpen = useStore((s) => s.setProcessesSectionOpen);
  return [
    { id: "files", open: filesOpen, setOpen: setFilesOpen },
    { id: "artifacts", open: artifactsOpen, setOpen: setArtifactsOpen },
    ...(processesEnabled
      ? [
          {
            id: "processes" as const,
            open: processesOpen,
            setOpen: setProcessesOpen,
          },
        ]
      : []),
  ];
}
