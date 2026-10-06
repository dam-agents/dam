import { useEffect, useMemo } from "react";

import { useStore } from "../../../store.js";
import type { ToolChip } from "../../../types.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useFeatures } from "../../features/api/queries.js";
import { browserLinksIn } from "../lib/browser-link.js";

const FINISHED = new Set(["completed", "failed"]);
const seenUnfinished = new Set<string>();
const autoOpened = new Set<string>();

export function useBrowserToolLinks(chip: ToolChip): string[] {
  const links = useMemo(
    () => browserLinksIn((chip.content ?? []).map((c) => c.text).join("\n")),
    [chip.content],
  );
  const agentId = useStore((s) => s.selectedAgent);
  const setOpenBrowser = useStore((s) => s.setOpenBrowser);
  const agents = useAgentsList();
  const flagged = useFeatures().data?.["strict-connection-addressing"] === true;
  const available =
    flagged &&
    agents.find((a) => a.id === agentId)?.requireConnectionAddress === true;
  const running = !FINISHED.has(chip.status);
  const key = chip.toolCallId ?? chip.title;

  useEffect(() => {
    if (running) seenUnfinished.add(key);
  }, [running, key]);

  useEffect(() => {
    const url = links[links.length - 1];
    if (!url || running || !seenUnfinished.has(key) || !available || !agentId)
      return;
    if (autoOpened.has(key)) return;
    autoOpened.add(key);
    setOpenBrowser(agentId, url);
  }, [links, running, available, agentId, key, setOpenBrowser]);

  return links;
}
