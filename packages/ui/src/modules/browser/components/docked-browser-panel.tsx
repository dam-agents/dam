import {
  ArrowLeft,
  ArrowRight,
  Close,
  ErrorFilled,
  Globe,
  Maximize,
  Minimize,
  OverflowMenuVertical,
  Renew,
} from "@carbon/icons-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import { useStore } from "../../../store.js";
import { useBrowserControl } from "../hooks/use-browser-control.js";
import { addressUrl } from "../lib/address.js";
import { StreamView } from "./stream-view.js";

const SIGN_IN_NOTICE_KEY = "platform.browserPanel.signInNoticeSeen";

interface Props {
  agentId: string;
  agentName: string;
}

export function DockedBrowserPanel({ agentId, agentName }: Props) {
  const close = useStore((s) => s.setOpenBrowser);
  const maximized = useStore((s) => s.browserMaximized);
  const setMaximized = useStore((s) => s.setBrowserMaximized);
  const showConfirm = useStore((s) => s.showConfirm);
  const openRequestId = useStore((s) => s.browserOpenRequest?.id);
  const takeOpenRequest = useStore((s) => s.takeBrowserOpenRequest);
  const screenRef = useRef<HTMLIFrameElement>(null);
  const stream = useBrowserControl(agentId);
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [noticeSeen, setNoticeSeen] = useState(() =>
    readPersistedFlag(SIGN_IN_NOTICE_KEY, false),
  );

  const shownUrl = stream.page.url === "about:blank" ? "" : stream.page.url;
  useEffect(() => {
    if (!editing) setAddress(shownUrl);
  }, [shownUrl, editing]);

  const { navigate } = stream;
  useEffect(() => {
    const request = takeOpenRequest();
    if (request) navigate(request.url);
  }, [openRequestId, takeOpenRequest, navigate]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = addressUrl(address);
    if (!url) return;
    stream.navigate(url);
    setEditing(false);
    screenRef.current?.focus();
  };

  const clearData = async () => {
    const ok = await showConfirm(
      "Sign-ins, cookies and site data stored in this agent's browser are deleted.",
      "Clear browser data?",
      { confirmLabel: "Clear" },
    );
    if (ok) stream.clearData();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span
          aria-hidden
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-accent-light text-accent"
        >
          {stream.page.loading ? <Spinner size={13} /> : <Globe size={13} />}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back"
          disabled={!stream.page.canGoBack}
          onClick={stream.back}
        >
          <ArrowLeft size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Forward"
          disabled={!stream.page.canGoForward}
          onClick={stream.forward}
        >
          <ArrowRight size={16} />
        </Button>
        <form onSubmit={submit} className="min-w-0 flex-1">
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => {
              setEditing(true);
              e.currentTarget.select();
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              setAddress(shownUrl);
              e.currentTarget.blur();
            }}
            placeholder="Search or enter address"
            title={stream.page.title || undefined}
            type="text"
            name="browser-address"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            aria-label="Address in the agent's browser"
            className="h-8 font-mono text-xs"
          />
        </form>
        {stream.page.loading ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Stop loading"
            onClick={stream.stop}
          >
            <Close size={16} />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reload"
            onClick={stream.reload}
          >
            <Renew size={16} />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Browser actions">
              <OverflowMenuVertical size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={stream.restartBrowser}>
              Restart browser
            </DropdownMenuItem>
            <DropdownMenuItem tone="danger" onSelect={() => void clearData()}>
              Clear browser data
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
          onClick={() => close(null)}
        >
          <Close size={16} />
        </Button>
      </div>

      <div className="relative flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-1.5 text-xs text-muted-foreground">
        {stream.page.title && (
          <span className="min-w-0 max-w-[50%] truncate font-medium text-foreground">
            {stream.page.title}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">
          Runs in {agentName}'s sandbox — not a page from this site
        </span>
        {stream.page.loading && (
          <span
            aria-hidden
            className="absolute inset-x-0 -bottom-px h-0.5 animate-pulse bg-accent"
          />
        )}
      </div>

      {!noticeSeen && (
        <Callout
          tone="info"
          size="sm"
          className="m-3 mb-0 flex items-start gap-3 text-xs"
        >
          <span className="flex-1">
            Sign-ins made here are stored in this agent, and the agent can use
            them. Clear them any time from the browser menu.
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              writePersistedFlag(SIGN_IN_NOTICE_KEY, true);
              setNoticeSeen(true);
            }}
          >
            Got it
          </Button>
        </Callout>
      )}

      {stream.error && (
        <p className="px-4 pt-2 text-xs text-danger">{stream.error}</p>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden overscroll-none bg-muted/30">
        <StreamView
          ref={screenRef}
          agentId={agentId}
          agentName={agentName}
          reconnects={stream.connects}
        />
        {(stream.connection === "connecting" ||
          (stream.connection === "live" &&
            stream.browser.state === "starting")) && (
          <div className="absolute inset-0 flex items-center justify-center gap-3 bg-background/80 text-sm text-muted-foreground">
            <Spinner size={18} />
            Starting the agent's browser…
          </div>
        )}
        {stream.connection === "live" && stream.browser.state === "failed" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 px-6 text-center">
            <ErrorFilled size={24} className="text-danger" />
            <p className="text-sm text-muted-foreground">
              {stream.browser.message ?? "The agent's browser did not start."}{" "}
              Retrying…
            </p>
            <Button variant="outline" onClick={stream.restartBrowser}>
              Restart browser
            </Button>
          </div>
        )}
        {stream.connection === "unavailable" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 px-6 text-center">
            <ErrorFilled size={24} className="text-danger" />
            <p className="text-sm text-muted-foreground">
              This agent's image has no browser display to show.
            </p>
          </div>
        )}
        {stream.connection === "disconnected" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 text-center">
            <ErrorFilled size={24} className="text-danger" />
            <p className="text-sm text-muted-foreground">
              The connection to the agent's browser closed. Retrying…
            </p>
            <Button variant="outline" onClick={stream.reconnect}>
              Reconnect
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
