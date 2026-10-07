import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useFeatures } from "../../features/api/queries.js";
import { type BrowserLink, isFreshLink } from "../lib/browser-link.js";

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

export function useAutoOpenBrowser(link: BrowserLink | null) {
  const setOpenBrowser = useStore((s) => s.setOpenBrowser);
  const { agentId, available } = useBrowserAvailable();
  const key = link ? `${link.url}@${link.at}` : null;

  useEffect(() => {
    if (!link || !key || !available || !agentId) return;
    if (opened.has(key) || !isFreshLink(link, Date.now())) return;
    opened.add(key);
    setOpenBrowser(agentId, link.url);
  }, [link, key, available, agentId, setOpenBrowser]);
}
