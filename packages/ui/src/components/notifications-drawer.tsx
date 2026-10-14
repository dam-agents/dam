import { ArrowLeft, ChevronRight, Close } from "@carbon/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useFeed } from "../modules/home/api/queries.js";
import { FeedCardSkeleton } from "../modules/home/components/feed-card-skeleton.js";
import { FeedEmptyState } from "../modules/home/components/feed-empty-state.js";
import {
  FeedFilterBar,
  type FeedTab,
} from "../modules/home/components/feed-filter-bar.js";
import { FeedList } from "../modules/home/components/feed-list.js";
import { useDismissals } from "../modules/home/hooks/use-dismissals.js";
import { useStickyResolved } from "../modules/home/hooks/use-sticky-resolved.js";
import { filterFeedByTab } from "../modules/home/lib/feed-filter.js";
import type { FeedItem } from "../modules/home/lib/feed-item.js";
import { useStore } from "../store.js";
import { useBodyScrollLock, useFocusTrap } from "./modal.js";

interface Props {
  open: boolean;
  onClose: () => void;
}

function DrawerContent({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useBodyScrollLock();

  const [visible, setVisible] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const feed = useFeed();
  const { isDismissed, dismiss } = useDismissals();
  const { labelFor: resolvedLabelFor, keep: markResolved } =
    useStickyResolved();

  const [tab, setTab] = useState<FeedTab>("all");
  const [showApprovals, setShowApprovals] = useState(false);

  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const allVisible = useMemo(
    () => feed.items.filter((item) => !isDismissed(item)),
    [feed.items, isDismissed],
  );

  const approvals = useMemo(
    () => allVisible.filter((i) => i.kind === "approval"),
    [allVisible],
  );

  const sessionItems = useMemo(
    () =>
      filterFeedByTab(
        allVisible.filter((i) => i.kind !== "approval"),
        tab,
      ),
    [allVisible, tab],
  );

  const handleDismiss = useCallback(
    (item: FeedItem) => dismiss([item]),
    [dismiss],
  );

  const handleResolved = useCallback(
    (item: FeedItem, label: string) => markResolved(item, label),
    [markResolved],
  );

  const handleOpenSession = useCallback(
    (agentId: string, _sessionId: string) => {
      navigateToSandboxHome(agentId);
      onClose();
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

        {showApprovals ? (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {approvals.length > 0 ? (
              <FeedList
                items={approvals}
                agents={feed.agents}
                onOpenSession={handleOpenSession}
                onDismiss={handleDismiss}
                onResolved={handleResolved}
                resolvedLabelFor={resolvedLabelFor}
              />
            ) : (
              <FeedEmptyState
                title="All clear"
                message="No pending approvals."
                tone="clear"
              />
            )}
          </div>
        ) : (
          <>
            <div className="border-b border-border px-6 py-3">
              <FeedFilterBar value={tab} onValueChange={setTab} />
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {feed.loadingFeed ? (
                <FeedCardSkeleton rows={3} />
              ) : (
                <div className="flex flex-col gap-3">
                  {approvals.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowApprovals(true)}
                      className="flex w-full items-center justify-between rounded-2xl border border-border bg-card/80 p-5 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/15 text-warning">
                          <span className="text-sm font-semibold">
                            {approvals.length}
                          </span>
                        </span>
                        <div>
                          <p className="text-[15px] font-semibold text-foreground">
                            Pending approvals
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {approvals.length === 1
                              ? "1 request needs your decision"
                              : `${approvals.length} requests need your decision`}
                          </p>
                        </div>
                      </div>
                      <ChevronRight
                        size={16}
                        className="shrink-0 text-muted-foreground"
                      />
                    </button>
                  )}

                  {sessionItems.length > 0 ? (
                    <FeedList
                      items={sessionItems}
                      agents={feed.agents}
                      onOpenSession={handleOpenSession}
                      onDismiss={handleDismiss}
                      onResolved={handleResolved}
                      resolvedLabelFor={resolvedLabelFor}
                    />
                  ) : approvals.length === 0 ? (
                    <FeedEmptyState
                      title="All clear"
                      message="Nothing matches these filters."
                      tone="filtered"
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

export function NotificationsDrawer({ open, onClose }: Props) {
  if (!open) return null;
  return <DrawerContent onClose={onClose} />;
}
