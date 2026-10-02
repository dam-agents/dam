import { ChevronDown, Close, Filter } from "@carbon/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { useBodyScrollLock, useFocusTrap } from "../../../components/modal.js";
import { useNotifications } from "../api/queries.js";
import {
  isNeedsYou,
  type NotificationItem,
} from "../lib/notification-types.js";
import { NotificationRow } from "./notification-row.js";

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

  const { items: allItems, agents, loading } = useNotifications();

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

  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.name);
    return map;
  }, [agents]);

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
    setTimeout(onClose, 300);
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

  const closeBtn = (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleBackdropClick}
      aria-label="Close approvals"
      data-dialog-close
    >
      <Close size={16} />
    </Button>
  );

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

  const portal = createPortal(
    <div className="fixed inset-0 z-overlay flex">
      <div
        className={cn(
          "flex-1 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          visible ? "bg-black/30" : "bg-transparent",
        )}
        onClick={handleBackdropClick}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Approvals waiting"
        className={cn(
          "flex h-full w-[520px] max-w-[90vw] flex-col border-l border-border bg-card shadow-2xl transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          visible
            ? "translate-x-0 opacity-100"
            : "translate-x-[60px] opacity-0",
        )}
      >
        <div className="shrink-0">
          <div className="flex items-center justify-between border-b border-border px-5 pt-5 pb-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              Approvals waiting
              {approvalItems.length > 0 && (
                <span className="rounded-full bg-warning/15 px-2 text-sm font-medium text-warning-fg">
                  {approvalItems.length}
                </span>
              )}
            </h2>
            {closeBtn}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1.5 border-b border-border pl-2.5 pr-5 py-3">
          {approvalFiltersJsx}
          {needsYouContextAction}
        </div>

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
          ) : filteredApprovalItems.length > 0 ? (
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
                  : "You’re all caught up. No approvals are waiting."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );

  return portal;
}
