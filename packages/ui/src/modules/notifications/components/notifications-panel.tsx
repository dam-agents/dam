import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Close,
  Filter,
  Warning,
} from "@carbon/icons-react";
import type { LibraryArtifact, SessionView } from "api-server-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNow } from "@/hooks/use-now";
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { useBodyScrollLock, useFocusTrap } from "../../../components/modal.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { ArtifactPreviewDialog } from "../../artifacts/components/artifact-preview-dialog.js";
import {
  routeToNavigationState,
  routeToPath,
} from "../../platform/lib/routes.js";
import { acpSessionsKeys, setSessionSeen } from "../../sessions/api/queries.js";
import { useNotifications } from "../api/queries.js";
import {
  applyFilters,
  type ChannelType,
  defaultFilters,
  isFiltered as checkIsFiltered,
  type NotificationFilters,
  type StateFilter,
} from "../lib/filters.js";
import {
  isNeedsYou,
  type NotificationItem,
} from "../lib/notification-types.js";
import { groupByTimeSection } from "../lib/time-sections.js";
import { NotificationRow } from "./notification-row.js";
import { ShowFilter } from "./show-filter.js";

function mockArtifactFor(name: string, agentId: string): LibraryArtifact {
  const ext = name.split(".").pop() ?? "";
  const kind = ext === "html" ? "html" : ext === "md" ? "markdown" : "binary";
  const contentType =
    kind === "html"
      ? "text/html"
      : kind === "markdown"
        ? "text/markdown"
        : "application/octet-stream";
  return {
    id: `mock-${name}`,
    title: name.replace(/[-_]/g, " ").replace(/\.\w+$/, ""),
    slug: name.replace(/\.\w+$/, ""),
    kind,
    contentType,
    fileName: name,
    sizeBytes: 24_000,
    version: 1,
    folderId: null,
    agentId,
    visibility: "private",
    expiresAt: null,
    viewCount: 0,
    shareUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NotificationsPanel({ open, onClose }: Props) {
  if (!open) return null;
  return <PanelContent onClose={onClose} />;
}

function PanelContent({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useBodyScrollLock();

  const [visible, setVisible] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const now = useNow(60_000);
  const { items: allItems, agents, loading } = useNotifications();

  const initialTab = useStore((s) => s.notificationsInitialTab);
  const [showNeedsYou, setShowNeedsYou] = useState(initialTab === "approvals");
  const [previewArtifact, setPreviewArtifact] =
    useState<LibraryArtifact | null>(null);

  const [filters, setFilters] = useState<NotificationFilters>(defaultFilters);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());
  const [approvalTypeFilter, setApprovalTypeFilter] = useState<
    "all" | "tool" | "network"
  >("all");
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<
    "all" | "active" | "expired"
  >("all");
  const approvalItems = useMemo(
    () => allItems.filter((i) => isNeedsYou(i) && !dismissedIds.has(i.id)),
    [allItems, dismissedIds],
  );

  const filteredApprovalItems = useMemo(() => {
    let items = approvalItems;
    if (approvalTypeFilter !== "all") {
      items = items.filter((i) =>
        approvalTypeFilter === "tool"
          ? i.type === "approval-tool"
          : i.type === "approval-network",
      );
    }
    if (approvalStatusFilter === "expired") {
      items = items.filter((i) => {
        const exp = (i as Record<string, unknown>).expiresAt;
        return typeof exp === "number" && exp < Date.now();
      });
    } else if (approvalStatusFilter === "active") {
      items = items.filter((i) => {
        const exp = (i as Record<string, unknown>).expiresAt;
        return typeof exp !== "number" || exp >= Date.now();
      });
    }
    return items;
  }, [approvalItems, approvalTypeFilter, approvalStatusFilter]);

  const sessionItems = useMemo(
    () => allItems.filter((i) => !isNeedsYou(i) && !dismissedIds.has(i.id)),
    [allItems, dismissedIds],
  );

  const filteredSessionItems = useMemo(
    () => applyFilters(sessionItems, filters, agents),
    [sessionItems, filters, agents],
  );

  const sections = useMemo(
    () => groupByTimeSection(filteredSessionItems, now.getTime()),
    [filteredSessionItems, now],
  );

  const filtered = checkIsFiltered(filters);

  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.name);
    return map;
  }, [agents]);

  const handleToggleChannelType = useCallback((type: ChannelType) => {
    setFilters((prev) => {
      const next = new Set(prev.channelTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...prev, channelTypes: next };
    });
  }, []);

  const handleChangeState = useCallback((state: StateFilter) => {
    setFilters((prev) => ({ ...prev, state }));
  }, []);

  const handleReset = useCallback(() => {
    setFilters(defaultFilters());
  }, []);

  const handleMarkAllRead = useCallback(() => {
    const unread = allItems.filter(
      (item): item is NotificationItem & { type: "unread" } =>
        item.type === "unread",
    );
    if (unread.length === 0) return;

    const snapshots = unread.map((item) => ({
      agentId: item.agentId,
      sessionId: item.session.sessionId,
      prevSeenAt: item.session.seenAt,
    }));

    for (const item of unread) {
      setSessionSeen(item.agentId, item.session.sessionId);
    }

    emitToast({
      kind: "info",
      message: `Marked ${unread.length} read.`,
      ttl: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          for (const snap of snapshots) {
            queryClient.setQueriesData(
              { queryKey: acpSessionsKeys.agentLists(snap.agentId) },
              (prev: SessionView[] | undefined) =>
                prev?.map((s) =>
                  s.sessionId === snap.sessionId
                    ? { ...s, seenAt: snap.prevSeenAt }
                    : s,
                ),
            );
          }
        },
      },
    });
  }, [allItems]);

  const handleOpenSession = useCallback(
    (item: NotificationItem) => {
      if (
        item.type === "running" ||
        item.type === "unread" ||
        item.type === "read"
      ) {
        const route = {
          view: "chat" as const,
          agent: item.agentId,
          session: item.session.sessionId,
        };
        history.pushState(null, "", routeToPath(route));
        useStore.setState(routeToNavigationState(route));
        setVisible(false);
        setTimeout(onClose, 200);
      }
    },
    [onClose],
  );

  const handleDismiss = useCallback((item: NotificationItem) => {
    setDismissingIds((prev) => new Set(prev).add(item.id));
    setTimeout(() => {
      setDismissingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setDismissedIds((prev) => new Set(prev).add(item.id));
    }, 300);
  }, []);

  const handleBackdropClick = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleBackdropClick();
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [handleBackdropClick]);

  const unreadCount = allItems.filter((item) => item.type === "unread").length;
  const hasUnread = unreadCount > 0;

  const closeBtn = (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleBackdropClick}
      aria-label="Close activity"
      data-dialog-close
    >
      <Close size={16} />
    </Button>
  );

  const feedContextAction = hasUnread ? (
    <button
      type="button"
      onClick={handleMarkAllRead}
      className="ml-auto shrink-0 text-sm text-accent transition-colors hover:text-accent/80"
      data-testid="mark-all-read"
    >
      Mark all read
    </button>
  ) : null;

  const needsYouContextAction =
    approvalItems.length > 0 ? (
      <button
        type="button"
        onClick={() => {
          for (const item of approvalItems) handleDismiss(item);
        }}
        className="ml-auto shrink-0 text-sm text-accent transition-colors hover:text-accent/80"
      >
        Dismiss all
      </button>
    ) : null;

  const approvalFiltersJsx = (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="text-sm font-normal text-muted-foreground"
          >
            <Filter size={16} />
            {approvalTypeFilter === "all"
              ? "All types"
              : approvalTypeFilter === "tool"
                ? "Tool"
                : "Network"}
            <ChevronDown size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {(["all", "tool", "network"] as const).map((t) => (
            <DropdownMenuItem
              key={t}
              onSelect={() => setApprovalTypeFilter(t)}
              className={approvalTypeFilter === t ? "font-medium" : undefined}
            >
              {t === "all" ? "All types" : t === "tool" ? "Tool" : "Network"}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="text-sm font-normal text-muted-foreground"
          >
            <Filter size={16} />
            {approvalStatusFilter === "all"
              ? "All statuses"
              : approvalStatusFilter === "active"
                ? "Active"
                : "Expired"}
            <ChevronDown size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {(["all", "active", "expired"] as const).map((s) => (
            <DropdownMenuItem
              key={s}
              onSelect={() => setApprovalStatusFilter(s)}
              className={approvalStatusFilter === s ? "font-medium" : undefined}
            >
              {s === "all"
                ? "All statuses"
                : s === "active"
                  ? "Active"
                  : "Expired"}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const feedFiltersJsx = (
    <ShowFilter
      filters={filters}
      onToggleChannelType={handleToggleChannelType}
      onChangeState={handleChangeState}
      onReset={handleReset}
      isFiltered={filtered}
    />
  );

  const portal = createPortal(
    <div className="fixed inset-0 z-overlay flex">
      <div
        className={cn(
          "flex-1 transition-colors duration-200",
          visible ? "bg-black/30" : "bg-transparent",
        )}
        onClick={handleBackdropClick}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Activity"
        className={cn(
          "flex h-full w-[520px] max-w-[90vw] flex-col border-l border-border bg-card shadow-xl transition-transform duration-200",
          visible ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header — matches DialogHeader pattern */}
        <div className="shrink-0">
          <div className="flex items-center justify-between border-b border-border px-5 pt-5 pb-4">
            {showNeedsYou ? (
              <button
                type="button"
                onClick={() => setShowNeedsYou(false)}
                className="flex items-center gap-2 text-base font-semibold text-foreground transition-colors hover:text-foreground/80"
              >
                <ArrowLeft size={16} />
                Needs you
              </button>
            ) : (
              <h2 className="text-base font-semibold text-foreground">
                Activity
              </h2>
            )}
            {closeBtn}
          </div>
        </div>

        {showNeedsYou ? (
          <>
            {/* Needs-you filter bar */}
            <div className="shrink-0 flex items-center gap-1.5 border-b border-border pl-2.5 pr-5 py-3">
              {approvalFiltersJsx}
              {needsYouContextAction}
            </div>

            {/* Needs-you content */}
            <div className="flex-1 overflow-y-auto px-2 py-4">
              {filteredApprovalItems.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {filteredApprovalItems.map((item) => (
                    <div
                      key={item.id}
                      className="overflow-hidden transition-all duration-300 ease-out"
                      style={
                        dismissingIds.has(item.id)
                          ? { opacity: 0, maxHeight: 0, marginBottom: 0 }
                          : { opacity: 1, maxHeight: 300 }
                      }
                    >
                      <NotificationRow
                        item={item}
                        agentName={agentNameMap.get(item.agentId) ?? "Agent"}
                        agents={agents}
                        onDismiss={() => handleDismiss(item)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    {approvalItems.length > 0
                      ? "Nothing matches your filters."
                      : "You’re all caught up."}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowNeedsYou(false)}
                    className="text-sm text-accent transition-colors hover:text-accent/80"
                  >
                    Back to Activity
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Feed filter bar */}
            <div className="shrink-0 flex items-center gap-1.5 border-b border-border pl-2.5 pr-5 py-3">
              {feedFiltersJsx}
              {feedContextAction}
            </div>

            {/* Feed content */}
            <div className="flex-1 overflow-y-auto px-2 py-4">
              {loading ? (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-16 animate-pulse rounded-xl bg-muted/40"
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {/* Approval banner */}
                  {approvalItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowNeedsYou(true)}
                      className="mx-1 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-left transition-colors hover:bg-warning/10 dark:border-warning/20 dark:bg-warning/10 dark:hover:bg-warning/15"
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 dark:bg-warning/20">
                        <Warning size={16} className="text-warning" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">
                          {approvalItems.length}{" "}
                          {approvalItems.length === 1
                            ? "approval"
                            : "approvals"}{" "}
                          waiting
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {approvalItems.length === 1
                            ? "An agent needs your decision"
                            : `${approvalItems.length} agents need your decision`}
                        </p>
                      </div>
                      <ChevronRight
                        size={16}
                        className="shrink-0 text-muted-foreground"
                      />
                    </button>
                  )}

                  {sections.length > 0 ? (
                    <>
                      {sections.map(({ section, items }) => (
                        <div key={section}>
                          <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[1.65px] text-muted-foreground">
                            {section}
                          </div>
                          <div className="flex flex-col gap-2">
                            {items.map((item) => (
                              <div
                                key={item.id}
                                className="overflow-hidden transition-all duration-300 ease-out"
                                style={
                                  dismissingIds.has(item.id)
                                    ? {
                                        opacity: 0,
                                        maxHeight: 0,
                                        marginBottom: 0,
                                      }
                                    : { opacity: 1, maxHeight: 200 }
                                }
                              >
                                <NotificationRow
                                  item={item}
                                  agentName={
                                    agentNameMap.get(item.agentId) ?? "Agent"
                                  }
                                  agents={agents}
                                  onOpen={
                                    item.type === "running" ||
                                    item.type === "unread" ||
                                    item.type === "read"
                                      ? () => handleOpenSession(item)
                                      : undefined
                                  }
                                  onArtifactClick={
                                    item.type !== "approval-tool" &&
                                    item.type !== "approval-network" &&
                                    item.artifactName
                                      ? () =>
                                          setPreviewArtifact(
                                            mockArtifactFor(
                                              item.artifactName!,
                                              item.agentId,
                                            ),
                                          )
                                      : undefined
                                  }
                                  onDismiss={() => handleDismiss(item)}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <EmptyState isFiltered={filtered} onReset={handleReset} />
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );

  return (
    <>
      {portal}
      {previewArtifact && (
        <ArtifactPreviewDialog
          artifact={previewArtifact}
          onClose={() => setPreviewArtifact(null)}
        />
      )}
    </>
  );
}

function EmptyState({
  isFiltered,
  onReset,
}: {
  isFiltered: boolean;
  onReset: () => void;
}) {
  if (isFiltered) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nothing matches your filters.
        </p>
        <button
          type="button"
          onClick={onReset}
          className="mt-1 text-sm text-accent transition-colors hover:text-accent/80"
        >
          Reset to default
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-16 text-center">
      <p className="text-sm text-muted-foreground">
        You&apos;re all caught up.
      </p>
    </div>
  );
}
