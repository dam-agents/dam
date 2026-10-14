import {
  ArrowLeft,
  ArrowRight,
  Close,
  Maximize,
  Minimize,
  Renew,
  Wikis,
} from "@carbon/icons-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";

import { addressUrl } from "../modules/browser/lib/address.js";
import { useStore } from "../store.js";

interface Props {
  agentId: string;
  agentName: string;
}

export function MockBrowserPanel({ agentId: _agentId, agentName }: Props) {
  const close = useStore((s) => s.setOpenBrowser);
  const maximized = useStore((s) => s.browserMaximized);
  const setMaximized = useStore((s) => s.setBrowserMaximized);
  const openRequestId = useStore((s) => s.browserOpenRequest?.id);
  const takeOpenRequest = useStore((s) => s.takeBrowserOpenRequest);
  const [address, setAddress] = useState(() => {
    const req = takeOpenRequest();
    return req?.url ?? "";
  });
  const [currentUrl, setCurrentUrl] = useState(address);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = addressUrl(address);
    if (!url) return;
    setCurrentUrl(url);
  };

  // Consume any new open requests
  if (openRequestId) {
    const req = takeOpenRequest();
    if (req) {
      setAddress(req.url);
      setCurrentUrl(req.url);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span
          aria-hidden
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-accent-light text-accent"
        >
          <Wikis size={13} />
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Back" disabled>
          <ArrowLeft size={16} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Forward" disabled>
          <ArrowRight size={16} />
        </Button>
        <form onSubmit={submit} className="min-w-0 flex-1">
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Search or enter address"
            type="text"
            name="browser-address"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Address in the agent's browser"
            className="h-8 font-mono text-xs"
          />
        </form>
        <Button variant="ghost" size="icon-sm" aria-label="Reload">
          <Renew size={16} />
        </Button>
        <RowActionsMenu label="Browser actions">
          <DropdownMenuItem>Restart browser</DropdownMenuItem>
          <DropdownMenuItem tone="danger">Clear browser data</DropdownMenuItem>
        </RowActionsMenu>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={maximized ? "Restore panel size" : "Maximize browser"}
          tooltip={maximized ? "Restore" : "Maximize"}
          onClick={() => setMaximized(!maximized)}
        >
          {maximized ? <Minimize size={16} /> : <Maximize size={16} />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          tooltip="Close"
          onClick={() => close(null)}
        >
          <Close size={16} />
        </Button>
      </div>

      <div className="relative flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-1.5 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          Runs in {agentName}'s sandbox — not a page from this site
        </span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden overscroll-none bg-muted/30">
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <Wikis size={32} className="opacity-30" />
          <p className="text-sm">Browser preview (mock mode)</p>
          {currentUrl && (
            <p className="max-w-[80%] truncate font-mono text-xs opacity-60">
              {currentUrl}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
