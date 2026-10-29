import { ErrorFilled, OverflowMenuVertical, Renew } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";

import { useDevToolsState } from "../../../../mock/dev-tools-state.js";
import { useStore } from "../../../../store.js";
import type { WorkBrowser } from "../../../../types.js";
import { browserLinkLabel } from "../../../browser/lib/browser-link.js";
import { WorkCardShell } from "./work-card-shell.js";

type BrowserStatus = NonNullable<WorkBrowser["status"]>;

function BrowserTrailingMenu() {
  const showConfirm = useStore.getState().showConfirm;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex transition-opacity ${menuOpen ? "opacity-100" : "opacity-0 group-hover/card:opacity-100"}`}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Browser actions">
            <OverflowMenuVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => {}}>
            <Renew size={13} /> Restart browser
          </DropdownMenuItem>
          <DropdownMenuItem
            tone="danger"
            onSelect={async () => {
              await showConfirm(
                "Sign-ins, cookies and site data stored in this agent's browser are deleted.",
                "Clear browser data?",
                { kind: "destructive", confirmLabel: "Clear data" },
              );
            }}
          >
            Clear browser data
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

export function BrowserCard({ part }: { part: WorkBrowser }) {
  const agentId = useStore((s) => s.selectedAgent);
  const setOpenBrowser = useStore((s) => s.setOpenBrowser);
  const devOverride = useDevToolsState((s) => s.browserStatus);
  const status: BrowserStatus =
    (import.meta.env.VITE_MOCK ? devOverride : null) ?? part.status ?? "ready";

  if (status === "starting") {
    return (
      <WorkCardShell
        title="Browser"
        detail="Starting…"
        accessory={<Spinner size={14} />}
        trailing={<BrowserTrailingMenu />}
      />
    );
  }

  if (status === "loading") {
    return (
      <WorkCardShell
        title={browserLinkLabel(part.url)}
        detail="Browser"
        accessory={<Spinner size={14} />}
        onClick={() => agentId && setOpenBrowser(agentId, part.url)}
        trailing={<BrowserTrailingMenu />}
      />
    );
  }

  if (status === "failed" || status === "error") {
    return (
      <WorkCardShell
        title="Browser"
        detail={part.errorMessage ?? "Failed to start. Retrying…"}
        accessory={
          <span className="flex items-center gap-1 text-danger">
            <ErrorFilled size={14} />
          </span>
        }
        trailing={
          <Button variant="outline" size="sm">
            Restart browser
          </Button>
        }
      />
    );
  }

  if (status === "unavailable") {
    return (
      <WorkCardShell
        title="Browser"
        detail="No browser display in this agent's image."
        accessory={
          <span className="flex items-center gap-1 text-danger">
            <ErrorFilled size={14} />
          </span>
        }
        trailing={<BrowserTrailingMenu />}
      />
    );
  }

  if (status === "disconnected") {
    return (
      <WorkCardShell
        title="Browser"
        detail="Connection lost. Retrying…"
        accessory={
          <span className="flex items-center gap-1 text-danger">
            <ErrorFilled size={14} />
          </span>
        }
        trailing={
          <Button variant="outline" size="sm" onClick={() => {}}>
            <Renew size={14} /> Reconnect
          </Button>
        }
      />
    );
  }

  if (status === "agent-asleep") {
    return (
      <WorkCardShell
        title={browserLinkLabel(part.url)}
        detail="Browser · Asleep"
        accessory={
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
            Asleep
          </span>
        }
        trailing={<BrowserTrailingMenu />}
      />
    );
  }

  if (status === "multi-tab") {
    return (
      <WorkCardShell
        title={browserLinkLabel(part.url)}
        detail={`Browser · ${part.tabCount ?? 3} tabs`}
        onClick={() => agentId && setOpenBrowser(agentId, part.url)}
        trailing={<BrowserTrailingMenu />}
      />
    );
  }

  return (
    <WorkCardShell
      title={browserLinkLabel(part.url)}
      detail="Browser"
      onClick={() => agentId && setOpenBrowser(agentId, part.url)}
      trailing={<BrowserTrailingMenu />}
    />
  );
}
