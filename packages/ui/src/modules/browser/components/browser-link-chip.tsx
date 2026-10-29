import { Globe } from "@carbon/icons-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { Tooltip } from "@/components/ui/tooltip";

import { useStore } from "../../../store.js";
import { agentTrpc } from "../../agents/agent-trpc.js";
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
  const showConfirm = useStore((s) => s.showConfirm);
  const { url } = link;

  const restartBrowser = () => {
    if (!agentId) return;
    agentTrpc(agentId).browser.restart.mutate().catch(() => {});
  };

  const clearData = async () => {
    if (!agentId) return;
    const ok = await showConfirm(
      "Sign-ins, cookies and site data stored in this agent's browser are deleted.",
      "Clear browser data?",
      { kind: "destructive", confirmLabel: "Clear data" },
    );
    if (ok) agentTrpc(agentId).browser.clearData.mutate().catch(() => {});
  };

  return (
    <span className="not-prose inline-flex max-w-full items-center gap-1 align-middle">
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
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-sm font-medium text-foreground transition-colors hover:border-accent hover:bg-accent-light hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-card disabled:hover:text-foreground"
        >
          <Globe size={13} className="shrink-0 text-muted-foreground" />
          <span className="truncate">Open {browserLinkLabel(url)}</span>
        </button>
      </Tooltip>
      {available && agentId && (
        <RowActionsMenu label="Browser actions">
          <DropdownMenuItem onSelect={restartBrowser}>
            Restart browser
          </DropdownMenuItem>
          <DropdownMenuItem tone="danger" onSelect={() => void clearData()}>
            Clear browser data
          </DropdownMenuItem>
        </RowActionsMenu>
      )}
    </span>
  );
}
