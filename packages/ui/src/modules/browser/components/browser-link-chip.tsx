import { Globe } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useFeatures } from "../../features/api/queries.js";
import { browserLinkLabel } from "../lib/browser-link.js";

export function BrowserLinkChip({ url }: { url: string }) {
  const agentId = useStore((s) => s.selectedAgent);
  const setOpenBrowser = useStore((s) => s.setOpenBrowser);
  const agents = useAgentsList();
  const flagged = useFeatures().data?.["strict-connection-addressing"] === true;
  const agent = agents.find((a) => a.id === agentId);
  const available =
    flagged && agentId !== null && agent?.requireConnectionAddress === true;
  const label = browserLinkLabel(url);

  return (
    <Tooltip
      content={
        available
          ? `Open ${url} in the agent's browser`
          : "The browser panel is not available for this agent"
      }
    >
      <button
        type="button"
        disabled={!available}
        onClick={() => agentId && setOpenBrowser(agentId, url)}
        className="not-prose inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 align-middle text-sm font-medium text-foreground transition-colors hover:border-accent hover:bg-accent-light hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-card disabled:hover:text-foreground"
      >
        <Globe size={13} className="shrink-0 text-muted-foreground" />
        <span className="truncate">Open {label}</span>
      </button>
    </Tooltip>
  );
}
