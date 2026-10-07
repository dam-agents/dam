import { useCallback, useEffect } from "react";

import { useDockDraftGuard } from "../../../hooks/use-dock-draft-guard.js";
import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useFeatures } from "../../features/api/queries.js";
import { type BrowserLink, mayAutoOpen } from "../lib/browser-link.js";

const opened = new Set<string>();

export function useBrowserAvailable(): {
  agentId: string | null;
  available: boolean;
} {
  const agentId = useStore((s) => s.selectedAgent);
  const agents = useAgentsList();
  const flagged = useFeatures().data?.["strict-connection-addressing"] === true;
  const available =
    flagged &&
    agentId !== null &&
    agents.find((a) => a.id === agentId)?.requireConnectionAddress === true;
  return { agentId, available };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the way a user opens the browser panel. The panel
 * takes the docked slot, which evicts an open file or artifact and its draft,
 * so it asks first, as every other opener of that slot does.
 */
export function useOpenBrowser() {
  const setOpenBrowser = useStore((s) => s.setOpenBrowser);
  const confirmDiscard = useDockDraftGuard();
  return useCallback(
    async (agentId: string, url?: string) => {
      if (!(await confirmDiscard())) return;
      setOpenBrowser(agentId, url);
    },
    [confirmDiscard, setOpenBrowser],
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a fresh browser link in the conversation opens
 * the panel once, by itself. Nobody asked for it, so it never prompts: while a
 * draft in the docked slot is unsaved it waits, and opens once the draft is
 * saved or closed if the link is still fresh.
 */
export function useAutoOpenBrowser(link: BrowserLink | null) {
  const setOpenBrowser = useStore((s) => s.setOpenBrowser);
  const draftOpen = useStore((s) => s.openArtifactDirty || s.openFileDirty);
  const { agentId, available } = useBrowserAvailable();
  const key = link ? `${link.url}@${link.at}` : null;

  useEffect(() => {
    if (!link || !key || !available || !agentId) return;
    const allowed = mayAutoOpen(link, {
      now: Date.now(),
      draftOpen,
      alreadyOpened: opened.has(key),
    });
    if (!allowed) return;
    opened.add(key);
    setOpenBrowser(agentId, link.url);
  }, [link, key, available, agentId, draftOpen, setOpenBrowser]);
}
