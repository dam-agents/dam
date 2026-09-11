import { ArrowLeft, ChevronRight, Close } from "@carbon/icons-react";
import type { SessionView } from "api-server-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { useBodyScrollLock, useFocusTrap } from "../../../components/modal.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { acpSessionsKeys, setSessionSeen } from "../../sessions/api/queries.js";
import { useNotifications } from "../api/queries.js";
import {
  applyFilters,
  countByAgent,
  countByType,
  defaultFilters,
  hiddenCount,
  isFiltered as checkIsFiltered,
  type NotificationFilters,
} from "../lib/filters.js";
import {
  isNeedsYou,
  type NotificationItem,
  type NotificationType,
} from "../lib/notification-types.js";
import { groupByTimeSection } from "../lib/time-sections.js";
import { NotificationRow } from "./notification-row.js";
import { ShowFilter } from "./show-filter.js";

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
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const [showApprovals, setShowApprovals] = useState(false);

  const allAgentIds = useMemo(() => agents.map((a) => a.id), [agents]);
  const [filters, setFilters] = useState<NotificationFilters>(() =>
    defaultFilters(allAgentIds),
  );

  useEffect(() => {
    setFilters((prev) => {
      const next = new Set(prev.agents);
      let changed = false;
      for (const id of allAgentIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? { ...prev, agents: next } : prev;
    });
  }, [allAgentIds]);

  const approvalItems = useMemo(() => allItems.filter(isNeedsYou), [allItems]);

  const sessionItems = useMemo(
    () => allItems.filter((i) => !isNeedsYou(i)),
    [allItems],
  );

  const filteredSessionItems = useMemo(
    () => applyFilters(sessionItems, filters),
    [sessionItems, filters],
  );

  const sections = useMemo(
    () => groupByTimeSection(filteredSessionItems, now.getTime()),
    [filteredSessionItems, now],
  );

  const typeCounts = useMemo(() => countByType(sessionItems), [sessionItems]);
  const agentCounts = useMemo(() => countByAgent(sessionItems), [sessionItems]);
  const filtered = checkIsFiltered(filters, allAgentIds);
  const hidden = hiddenCount(sessionItems, filteredSessionItems);

  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.name);
    return map;
  }, [agents]);

  const handleToggleType = useCallback((type: NotificationType) => {
    setFilters((prev) => {
      const next = new Set(prev.types);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...prev, types: next };
    });
  }, []);

  const handleToggleAgent = useCallback((agentId: string) => {
    setFilters((prev) => {
      const next = new Set(prev.agents);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return { ...prev, agents: next };
    });
  }, []);

  const handleReset = useCallback(() => {
    setFilters(defaultFilters(allAgentIds));
  }, [allAgentIds]);

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

  const handleDismiss = useCallback((item: NotificationItem) => {
    if (item.type === "unread" || item.type === "running") {
      setSessionSeen(item.agentId, item.session.sessionId);
    }
  }, []);

  const handleOpenSession = useCallback(
    (item: NotificationItem) => {
      if (item.type === "running" || item.type === "unread") {
        navigateToSandboxHome(item.agentId);
        setVisible(false);
        setTimeout(onClose, 200);
      }
    },
    [navigateToSandboxHome, onClose],
  );

  const handleBackdropClick = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showApprovals) {
          setShowApprovals(false);
        } else {
          handleBackdropClick();
        }
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [handleBackdropClick, showApprovals]);

  const hasUnread = allItems.some((item) => item.type === "unread");

  return createPortal(
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
        aria-label="Notifications"
        className={cn(
          "flex h-full w-[520px] max-w-[90vw] flex-col border-l border-border bg-card shadow-xl transition-transform duration-200",
          visible ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          {showApprovals ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowApprovals(false)}
                className="flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Back to notifications"
              >
                <ArrowLeft size={16} />
              </button>
              <h2 className="text-lg font-semibold text-foreground">
                Approvals
              </h2>
            </div>
          ) : (
            <h2 className="text-lg font-semibold text-foreground">
              Notifications
            </h2>
          )}
          <div className="flex items-center gap-2">
            {!showApprovals && hasUnread && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-sm text-accent transition-colors hover:text-accent/80"
                data-testid="mark-all-read"
              >
                Mark all read
              </button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBackdropClick}
              aria-label="Close notifications"
              data-dialog-close
            >
              <Close size={16} />
            </Button>
          </div>
        </div>

        {showApprovals ? (
          /* Nested approvals view */
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {approvalItems.length > 0 ? (
              <div className="flex flex-col gap-2">
                {approvalItems.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    agentName={agentNameMap.get(item.agentId) ?? "Agent"}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-16 text-center">
                <p className="text-sm text-muted-foreground">
                  No pending approvals.
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Main notifications view */
          <>
            {/* Filters bar */}
            <div className="border-b border-border px-6 py-2">
              <ShowFilter
                filters={filters}
                onToggleType={handleToggleType}
                onToggleAgent={handleToggleAgent}
                onReset={handleReset}
                typeCounts={typeCounts}
                agentCounts={agentCounts}
                agents={agents}
                isFiltered={filtered}
                hiddenCount={hidden}
              />
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
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
                  {/* Approvals summary card */}
                  {approvalItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowApprovals(true)}
                      className="flex w-full items-center justify-between rounded-2xl border border-warning/30 bg-warning/5 p-4 text-left transition-colors hover:bg-warning/10"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/15 text-warning">
                          <span className="text-sm font-semibold">
                            {approvalItems.length}
                          </span>
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            Pending approvals
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {approvalItems.length === 1
                              ? "1 request needs your decision"
                              : `${approvalItems.length} requests need your decision`}
                          </p>
                        </div>
                      </div>
                      <ChevronRight
                        size={16}
                        className="shrink-0 text-muted-foreground"
                      />
                    </button>
                  )}

                  {/* Session items by time section */}
                  {sections.length > 0 ? (
                    sections.map(({ section, items }) => (
                      <div key={section}>
                        <div className="px-1 pb-1 pt-2 text-sm font-medium text-muted-foreground">
                          {section}
                        </div>
                        <div className="flex flex-col">
                          {items.map((item) => (
                            <NotificationRow
                              key={item.id}
                              item={item}
                              agentName={
                                agentNameMap.get(item.agentId) ?? "Agent"
                              }
                              onOpen={
                                item.type === "running" ||
                                item.type === "unread"
                                  ? () => handleOpenSession(item)
                                  : undefined
                              }
                              onDismiss={() => handleDismiss(item)}
                            />
                          ))}
                        </div>
                      </div>
                    ))
                  ) : approvalItems.length === 0 ? (
                    <EmptyState
                      isFiltered={filtered}
                      hiddenCount={hidden}
                      onReset={handleReset}
                    />
                  ) : null}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function EmptyState({
  isFiltered,
  hiddenCount: hidden,
  onReset,
}: {
  isFiltered: boolean;
  hiddenCount: number;
  onReset: () => void;
}) {
  if (isFiltered) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <p className="text-sm text-muted-foreground">Nothing matches.</p>
        <p className="text-sm text-muted-foreground">
          {hidden} hidden by filters.
        </p>
        <button
          type="button"
          onClick={onReset}
          className="mt-1 text-sm text-accent transition-colors hover:text-accent/80"
        >
          Reset
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
