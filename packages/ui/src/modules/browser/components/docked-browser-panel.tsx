import {
  Add,
  ArrowLeft,
  ArrowRight,
  Close,
  ErrorFilled,
  Renew,
} from "@carbon/icons-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import { useStore } from "../../../store.js";
import { SidePanelCloseButton } from "../../sessions/components/side-panel-close-button.js";
import { useBrowserControl } from "../hooks/use-browser-control.js";
import { addressUrl } from "../lib/address.js";
import { browserLinkLabel } from "../lib/browser-link.js";
import { showsTabBar } from "../lib/tabs.js";
import { BrowserTabBar } from "./browser-tab-bar.js";
import { StreamView } from "./stream-view.js";

const SIGN_IN_NOTICE_KEY = "platform.browserPanel.signInNoticeSeen";

interface Props {
  agentId: string;
  agentName: string;
}

export function DockedBrowserPanel({ agentId, agentName }: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const openRequestId = useStore((s) => s.browserOpenRequest?.id);
  const takeOpenRequest = useStore((s) => s.takeBrowserOpenRequest);
  const screenRef = useRef<HTMLIFrameElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    if (editing) addressRef.current?.select();
  }, [editing]);
  const showsHost = !editing && shownUrl !== "";

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

  const openTab = () => {
    stream.newTab();
    setAddress("");
    addressRef.current?.focus();
  };

  const clearData = async () => {
    const ok = await showConfirm(
      "Sign-ins, cookies and site data stored in this agent's browser are deleted.",
      "Clear browser data?",
      { kind: "destructive", confirmLabel: "Clear data" },
    );
    if (ok) stream.clearData();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back"
          tooltip="Back"
          disabled={!stream.page.canGoBack}
          onClick={stream.back}
        >
          <ArrowLeft size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Forward"
          tooltip="Forward"
          disabled={!stream.page.canGoForward}
          onClick={stream.forward}
        >
          <ArrowRight size={16} />
        </Button>
        <form onSubmit={submit} className="relative min-w-0 flex-1">
          <Input
            ref={addressRef}
            value={showsHost ? browserLinkLabel(shownUrl) : address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              setAddress(shownUrl);
              e.currentTarget.blur();
            }}
            placeholder="Search or enter address"
            title={
              [stream.page.title, shownUrl].filter(Boolean).join("\n") ||
              undefined
            }
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
            className={cn(
              "h-8 pr-8 text-xs",
              showsHost ? "truncate" : "font-mono",
            )}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            aria-label={stream.page.loading ? "Stop loading" : "Reload"}
            tooltip={stream.page.loading ? "Stop loading" : "Reload"}
            onClick={stream.page.loading ? stream.stop : stream.reload}
          >
            {stream.page.loading ? <Close size={14} /> : <Renew size={14} />}
          </Button>
        </form>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New tab"
          tooltip="New tab"
          onClick={openTab}
        >
          <Add size={16} />
        </Button>
        <RowActionsMenu label="Browser actions">
          <DropdownMenuItem onSelect={stream.restartBrowser}>
            Restart browser
          </DropdownMenuItem>
          <DropdownMenuItem tone="danger" onSelect={() => void clearData()}>
            Clear browser data
          </DropdownMenuItem>
        </RowActionsMenu>
        <SidePanelCloseButton corner="-mr-3" />
        {stream.page.loading && (
          <span
            aria-hidden
            className="absolute inset-x-0 -bottom-px h-0.5 animate-pulse bg-accent"
          />
        )}
      </div>

      {showsTabBar(stream.tabs) && (
        <BrowserTabBar
          tabs={stream.tabs}
          activeTab={stream.activeTab}
          onSelect={stream.selectTab}
          onClose={stream.closeTab}
        />
      )}

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
