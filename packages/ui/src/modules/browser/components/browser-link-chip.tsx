import { Globe } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";

import {
  useAutoOpenBrowser,
  useBrowserAvailable,
  useOpenBrowser,
} from "../hooks/use-auto-open-browser.js";
import { type BrowserLink, browserLinkLabel } from "../lib/browser-link.js";

export function BrowserLinkChip({ link }: { link: BrowserLink }) {
  const openBrowser = useOpenBrowser();
  const { agentId, available } = useBrowserAvailable();
  useAutoOpenBrowser(link);
  const { url } = link;

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
        onClick={() => agentId && void openBrowser(agentId, url)}
        className="not-prose inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 align-middle text-sm font-medium text-foreground transition-colors hover:border-accent hover:bg-accent-light hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-card disabled:hover:text-foreground"
      >
        <Globe size={13} className="shrink-0 text-muted-foreground" />
        <span className="truncate">Open {browserLinkLabel(url)}</span>
      </button>
    </Tooltip>
  );
}
