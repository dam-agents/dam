import {
  Add,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Close,
  Globe,
  Renew,
} from "@carbon/icons-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { addressUrl } from "../modules/browser/lib/address.js";
import { useStore } from "../store.js";

interface MockTab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
}

const ONE_TAB: MockTab[] = [
  {
    id: "tab-1",
    url: "http://localhost:3000/dashboard",
    title: "Dashboard — My App",
    loading: false,
  },
];

const THREE_TABS: MockTab[] = [
  {
    id: "tab-1",
    url: "http://localhost:3000/dashboard",
    title: "Dashboard — My App",
    loading: false,
  },
  {
    id: "tab-2",
    url: "https://docs.example.com/api/v2",
    title: "API Reference",
    loading: false,
  },
  {
    id: "tab-3",
    url: "https://github.com/org/repo/pull/42",
    title: "feat: add CSV export by agent-codex · Pull Request #42",
    loading: true,
  },
];

function hostnameOnly(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function hostLabel(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname === "/" ? "" : pathname}`;
  } catch {
    return url;
  }
}

interface Props {
  agentId: string;
  agentName: string;
  initialTabs?: "one" | "three";
}

export function MockBrowserPanel({
  agentId: _agentId,
  agentName: _agentName,
  initialTabs = "one",
}: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const openRequestId = useStore((s) => s.browserOpenRequest?.id);
  const takeOpenRequest = useStore((s) => s.takeBrowserOpenRequest);
  const close = useStore((s) => s.setOpenBrowser);

  const [tabs, setTabs] = useState<MockTab[]>(
    initialTabs === "three" ? THREE_TABS : ONE_TAB,
  );
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? "");
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const [address, setAddress] = useState(activeTab?.url ?? "");
  const [editing, setEditing] = useState(false);
  const [noticeSeen, setNoticeSeen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);

  const checkOverflow = useCallback(() => {
    const el = tabsRef.current;
    if (el) setTabsOverflow(el.scrollWidth > el.clientWidth);
  }, []);

  useEffect(() => {
    checkOverflow();
    const el = tabsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [checkOverflow, tabs.length]);

  const shownUrl =
    activeTab?.url === "about:blank" ? "" : (activeTab?.url ?? "");
  const showsHost = !editing && shownUrl !== "";

  if (openRequestId) {
    const req = takeOpenRequest();
    if (req) {
      setAddress(req.url);
      const updated = tabs.map((t) =>
        t.id === activeTabId ? { ...t, url: req.url, title: req.url } : t,
      );
      setTabs(updated);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = addressUrl(address);
    if (!url) return;
    const updated = tabs.map((t) =>
      t.id === activeTabId ? { ...t, url, title: url } : t,
    );
    setTabs(updated);
    setEditing(false);
    setLoading(true);
    setTimeout(() => setLoading(false), 1500);
  };

  const selectTab = (id: string) => {
    setActiveTabId(id);
    const tab = tabs.find((t) => t.id === id);
    if (tab) setAddress(tab.url);
  };

  const closeTab = (id: string) => {
    const at = tabs.findIndex((t) => t.id === id);
    if (tabs.length === 1) return;
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (activeTabId === id) {
      const next = tabs[at + 1] ?? tabs[at - 1];
      if (next) selectTab(next.id);
    }
  };

  const openTab = () => {
    const id = `tab-${Date.now()}`;
    const newTab: MockTab = {
      id,
      url: "about:blank",
      title: "New tab",
      loading: false,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
    setAddress("");
  };

  const clearData = async () => {
    const ok = await showConfirm(
      "Sign-ins, cookies and site data stored in this agent's browser are deleted.",
      "Clear browser data?",
      { kind: "destructive", confirmLabel: "Clear data" },
    );
    if (ok) {
      setTabs([
        {
          id: "tab-fresh",
          url: "about:blank",
          title: "New tab",
          loading: false,
        },
      ]);
      setActiveTabId("tab-fresh");
      setAddress("");
    }
  };

  const isLoading = loading || (activeTab?.loading ?? false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tab bar — always visible */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        <div
          ref={tabsRef}
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
        >
          {tabs.map((t) => {
            const isActive = t.id === activeTabId;
            const label =
              t.url === "about:blank" ? "New tab" : hostnameOnly(t.url);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTab(t.id)}
                title={`${t.title}\n${t.url}`}
                className={cn(
                  "group/tab flex max-w-[240px] shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm",
                  isActive
                    ? "bg-[#f2f4f8] text-foreground dark:bg-[#343a3f]"
                    : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t.loading ? <Spinner size={14} className="shrink-0" /> : null}
                <span className="min-w-0 truncate">{label}</span>
                {tabs.length > 1 && (
                  <button
                    type="button"
                    aria-label="Close tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                    className="shrink-0 rounded p-0.5 opacity-0 hover:bg-foreground/10 group-hover/tab:opacity-100"
                  >
                    <Close size={12} />
                  </button>
                )}
              </button>
            );
          })}
          {/* + new tab — sits right next to the last tab */}
          <button
            type="button"
            aria-label="New tab"
            onClick={openTab}
            className="flex h-8 shrink-0 items-center justify-center rounded-lg bg-background px-3 text-muted-foreground hover:text-foreground"
          >
            <Add size={16} />
          </button>
        </div>
        {/* Right-pinned controls */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {tabsOverflow && (
            <button
              type="button"
              aria-label="More tabs"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronDown size={16} />
            </button>
          )}
          <RowActionsMenu label="Browser actions">
            <DropdownMenuItem>Restart browser</DropdownMenuItem>
            <DropdownMenuItem tone="danger" onSelect={() => void clearData()}>
              Clear browser data
            </DropdownMenuItem>
          </RowActionsMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close panel"
            onClick={() => close(null)}
            className="max-md:hidden"
          >
            <Close size={16} />
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="relative flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back"
          tooltip="Back"
          disabled
        >
          <ArrowLeft size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Forward"
          tooltip="Forward"
          disabled
        >
          <ArrowRight size={16} />
        </Button>
        <form onSubmit={submit} className="relative min-w-0 flex-1">
          <Input
            value={showsHost ? hostLabel(shownUrl) : address}
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
              [activeTab?.title, shownUrl].filter(Boolean).join("\n") ||
              undefined
            }
            type="text"
            name="browser-address"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
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
            aria-label={isLoading ? "Stop loading" : "Reload"}
            tooltip={isLoading ? "Stop loading" : "Reload"}
            onClick={() => {
              if (isLoading) {
                setLoading(false);
              } else {
                setLoading(true);
                setTimeout(() => setLoading(false), 1500);
              }
            }}
          >
            {isLoading ? <Close size={14} /> : <Renew size={14} />}
          </Button>
        </form>
        {isLoading && (
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
          className="flex items-start gap-3 rounded-none border-x-0 border-t-0 text-xs"
        >
          <span className="flex-1">
            Sign-ins made here are stored in this agent, and the agent can use
            them. Clear them any time from the browser menu.
          </span>
          <Button variant="ghost" size="sm" onClick={() => setNoticeSeen(true)}>
            Got it
          </Button>
        </Callout>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden overscroll-none bg-muted/30">
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <Globe size={32} className="opacity-30" />
          <p className="text-sm">Browser preview (mock mode)</p>
          {shownUrl && (
            <p className="max-w-[80%] truncate font-mono text-xs opacity-60">
              {shownUrl}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
