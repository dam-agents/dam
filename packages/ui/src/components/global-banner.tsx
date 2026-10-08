import { Close, Menu, Notification, Search } from "@carbon/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { getBrand } from "../brand.js";
import { timeAgo } from "../lib/format-time.js";
import { useAgentsList } from "../modules/agents/api/queries.js";
import { useNotifications } from "../modules/notifications/api/queries.js";
import { isNeedsYou } from "../modules/notifications/lib/notification-types.js";
import { useStore } from "../store.js";
import { BrandLogo } from "./brand-logo.js";
import { stateLabel } from "./status-indicator.js";

type SearchCategory =
  | "all"
  | "agents"
  | "sessions"
  | "artifacts"
  | "connections"
  | "skills"
  | "schedules";

const CATEGORIES: { key: SearchCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "agents", label: "Agents" },
  { key: "sessions", label: "Sessions" },
  { key: "artifacts", label: "Artifacts" },
  { key: "connections", label: "Connections" },
  { key: "skills", label: "Skills" },
  { key: "schedules", label: "Schedules" },
];

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  category: SearchCategory;
  navigate: () => void;
}

export function GlobalBanner() {
  const expandedNav = useStore((s) => s.sidebarExpanded);
  const setExpandedNav = useStore((s) => s.setSidebarExpanded);
  const toggleNotifications = useStore((s) => s.toggleNotifications);
  const { items: notifItems } = useNotifications();
  const needsYouCount = notifItems.filter(isNeedsYou).length;

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<SearchCategory>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const agents = useAgentsList();
  const setView = useStore((s) => s.setView);
  const selectAgent = useStore((s) => s.selectAgent);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const { items: notificationItems, agents: notifAgents } = useNotifications();

  const results = useMemo((): SearchResult[] => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const out: SearchResult[] = [];

    if (activeCategory === "all" || activeCategory === "agents") {
      for (const agent of agents) {
        if (agent.name.toLowerCase().includes(q)) {
          out.push({
            id: `agent-${agent.id}`,
            title: agent.name,
            subtitle:
              stateLabel[agent.state as keyof typeof stateLabel] ?? agent.state,
            category: "agents",
            navigate: () => selectAgent(agent.id),
          });
        }
      }
    }

    if (activeCategory === "all" || activeCategory === "sessions") {
      for (const item of notificationItems) {
        if (
          item.type !== "running" &&
          item.type !== "unread" &&
          item.type !== "read"
        )
          continue;
        const title = item.session?.title ?? "";
        const agentName =
          notifAgents.find((a) => a.id === item.agentId)?.name ?? "";
        if (
          title.toLowerCase().includes(q) ||
          agentName.toLowerCase().includes(q)
        ) {
          out.push({
            id: `session-${item.session.sessionId}`,
            title: title || "Untitled session",
            subtitle: `${agentName} · ${item.at ? timeAgo(new Date(item.at), new Date()) : ""}`,
            category: "sessions",
            navigate: () => {
              const { openAgentSession } = useStore.getState();
              openAgentSession(item.agentId, item.session.sessionId);
            },
          });
        }
      }
    }

    if (activeCategory === "all" || activeCategory === "artifacts") {
      if (
        "artifacts".includes(q) ||
        "files".includes(q) ||
        "documents".includes(q)
      ) {
        out.push({
          id: "artifacts-view",
          title: "Artifacts",
          subtitle: "View all artifacts",
          category: "artifacts",
          navigate: () => setView("artifacts"),
        });
      }
    }

    if (activeCategory === "all" || activeCategory === "schedules") {
      if (
        "schedules".includes(q) ||
        "cron".includes(q) ||
        "recurring".includes(q)
      ) {
        out.push({
          id: "schedules-view",
          title: "Schedules",
          subtitle: "View all schedules",
          category: "schedules",
          navigate: () => setView("schedules"),
        });
      }
    }

    if (activeCategory === "all" || activeCategory === "skills") {
      if (
        "skills".includes(q) ||
        "starter".includes(q) ||
        "kits".includes(q) ||
        "packs".includes(q)
      ) {
        out.push({
          id: "packs-view",
          title: "Starter Kits",
          subtitle: "Browse starter kits and packs",
          category: "skills",
          navigate: () => setView("presets"),
        });
      }
    }

    if (activeCategory === "all" || activeCategory === "connections") {
      if (
        "connections".includes(q) ||
        "integrations".includes(q) ||
        "oauth".includes(q)
      ) {
        out.push({
          id: "connections-view",
          title: "Connections",
          subtitle: "Manage integrations",
          category: "connections",
          navigate: () => navigateToSettings(),
        });
      }
    }

    return out.slice(0, 12);
  }, [
    query,
    activeCategory,
    agents,
    notificationItems,
    notifAgents,
    selectAgent,
    setView,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, activeCategory]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setQuery("");
        setActiveCategory("all");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const handleSelect = useCallback((result: SearchResult) => {
    result.navigate();
    setSearchOpen(false);
    setQuery("");
    setActiveCategory("all");
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    }
  };

  return (
    <>
      <header className="relative z-30 flex h-12 shrink-0 items-center border-b border-border bg-card px-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpandedNav(!expandedNav)}
            aria-label={expandedNav ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={expandedNav}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Menu size={16} />
          </button>
          <button
            type="button"
            onClick={() => setView("home")}
            aria-label={getBrand().name}
            className="rounded-lg p-0.5 text-foreground transition-colors hover:opacity-80"
          >
            <BrandLogo />
          </button>
        </div>

        <div className="flex-1 flex justify-center px-4">
          <button
            type="button"
            onClick={() => {
              setSearchOpen(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="flex h-8 w-[320px] items-center gap-2 rounded-full bg-muted/70 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
          >
            <Search size={16} />
            <span className="flex-1 text-left">Search</span>
            <kbd className="font-sans text-sm opacity-70">⌘K</kbd>
          </button>
        </div>

        <div className="flex items-center">
          <button
            type="button"
            onClick={toggleNotifications}
            aria-label={
              needsYouCount > 0
                ? `Notifications, ${needsYouCount} need attention`
                : "Notifications"
            }
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Notification size={16} />
            {needsYouCount > 0 && (
              <Badge
                variant="default"
                className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-0 bg-warning px-1 text-[10px] font-bold text-white hover:bg-warning"
              >
                {needsYouCount > 9 ? "9+" : needsYouCount}
              </Badge>
            )}
          </button>
        </div>
      </header>

      {searchOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/20"
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
              setActiveCategory("all");
            }}
          />
          <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-[14vh]">
            <div className="flex max-h-[60vh] w-[560px] flex-col overflow-hidden rounded-2xl bg-background shadow-[0_16px_48px_rgba(0,0,0,0.18)] anim-in">
              <div className="flex items-center gap-3 px-4 py-3">
                <Search size={16} className="text-muted-foreground" />
                <input
                  ref={inputRef}
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search agents, sessions, artifacts..."
                  className="flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                  autoComplete="off"
                  spellCheck={false}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  >
                    <Close size={16} />
                  </button>
                )}
              </div>

              <div className="flex gap-1 border-t border-border px-4 py-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => setActiveCategory(cat.key)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-sm font-medium transition-colors",
                      activeCategory === cat.key
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                {query && results.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No results for "{query}"
                  </div>
                )}
                {!query && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Start typing to search across all of DAM
                  </div>
                )}
                {results.map((result, i) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      i === selectedIndex ? "bg-muted" : "hover:bg-muted/50",
                    )}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <CategoryIcon category={result.category} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {result.title}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {result.subtitle}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground capitalize">
                      {result.category}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function CategoryIcon({ category }: { category: SearchCategory }) {
  const size = 16;
  switch (category) {
    case "agents":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor">
          <path d="M26 20h-6v-2h6v2zm-16 0H4v-2h6v2zm22-4H0v-2h32v2zM10 8h12v2H10V8z" />
        </svg>
      );
    case "sessions":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor">
          <path d="M17.74 30L16 29l4-7h6a2 2 0 002-2V8a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2h9v2H6a4 4 0 01-4-4V8a4 4 0 014-4h20a4 4 0 014 4v12a4 4 0 01-4 4h-4.84z" />
        </svg>
      );
    case "artifacts":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor">
          <path d="M26 2H6a2 2 0 00-2 2v24a2 2 0 002 2h14l8-8V4a2 2 0 00-2-2zM6 4h20v14h-6a2 2 0 00-2 2v6H6z" />
        </svg>
      );
    case "connections":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor">
          <path d="M23 16.01l-7-7-1.414 1.414L19.172 15H8v2h11.172l-4.586 4.576L16.01 23l7-7z" />
          <path d="M16 2a14 14 0 1014 14A14 14 0 0016 2zm0 26a12 12 0 1112-12 12 12 0 01-12 12z" />
        </svg>
      );
    case "skills":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor">
          <path d="M27 22.14V9.86L16.57 4.14a1.18 1.18 0 00-1.14 0L5 9.86v12.28l10.43 5.72a1.18 1.18 0 001.14 0zm-11-16l8.14 4.46L16 15.14 7.86 10.6zM7 12.32l8 4.39v8.97l-8-4.39zm10 13.36v-8.97l8-4.39v8.97z" />
        </svg>
      );
    case "schedules":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor">
          <path d="M16 30a14 14 0 1114-14 14 14 0 01-14 14zm0-26a12 12 0 1012 12A12 12 0 0016 4z" />
          <path d="M20.59 22L15 16.41V7h2v8.58l5 5.01z" />
        </svg>
      );
    default:
      return <Search size={size} />;
  }
}
