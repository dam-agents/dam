import { Activity, ArrowLeft, Close, Warning } from "@carbon/icons-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  DialogHeader,
  Modal,
  useBodyScrollLock,
  useFocusTrap,
} from "../../../components/modal.js";
import { useStore } from "../../../store.js";
import { useArtifact } from "../../artifacts/api/queries.js";
import { ArtifactPreviewDialog } from "../../artifacts/components/artifact-preview-dialog.js";
import {
  type ArtifactTouched,
  useFeed,
  useFeedArtifacts,
} from "../api/queries.js";
import { useDismissals } from "../hooks/use-dismissals.js";
import { useStickyResolved } from "../hooks/use-sticky-resolved.js";
import { useWaitingApprovals } from "../hooks/use-waiting-approvals.js";
import {
  type ActivityFilters,
  applyActivityFilters,
  type ChannelType,
  defaultActivityFilters,
  isFiltered as filtersDiffer,
  type StateFilter,
} from "../lib/activity-filter.js";
import type { FeedItem } from "../lib/feed-item.js";
import { ActivityFilterBar } from "./activity-filter-bar.js";
import { FeedCardSkeleton } from "./feed-card-skeleton.js";
import { FeedList } from "./feed-list.js";

const EMPTY_ARTIFACTS: readonly ArtifactTouched[] = [];

export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { items, agents, loadingFeed } = useFeed();
  const openAgentSession = useStore((s) => s.openAgentSession);
  const { isDismissed, dismiss, dismissedAt } = useDismissals();
  const sticky = useStickyResolved();
  const artifacts = useFeedArtifacts(items);
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(
    null,
  );
  const { data: previewArtifact, isError: previewFailed } =
    useArtifact(previewArtifactId);
  const [filters, setFilters] = useState<ActivityFilters>(
    defaultActivityFilters,
  );
  const [needsYou, setNeedsYou] = useState(false);

  const artifactsFor = (item: FeedItem): readonly ArtifactTouched[] => {
    if (item.kind !== "unread") return EMPTY_ARTIFACTS;
    const touched = artifacts.bySession.get(item.session.sessionId);
    if (!touched || touched.length === 0) return EMPTY_ARTIFACTS;
    const cleared = dismissedAt(item.agentId, item.session.sessionId);
    if (cleared === null) return touched;
    return touched.filter((t) => Date.parse(t.touchedAt) > cleared);
  };

  const live = sticky.merge(items).filter((item) => !isDismissed(item));
  const visible = applyActivityFilters(live, filters, agents);
  const dismissible = visible.filter((item) => item.kind !== "in-progress");
  const filtered = filtersDiffer(filters);
  const approvals = applyActivityFilters(
    useWaitingApprovals(),
    filters,
    agents,
  );
  const shown = needsYou ? approvals : visible;

  const toggleChannelType = (type: ChannelType) =>
    setFilters((prev) => {
      const next = new Set(prev.channelTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...prev, channelTypes: next };
    });
  const changeState = (state: StateFilter) =>
    setFilters((prev) => ({ ...prev, state }));

  return (
    <>
      <Drawer onClose={onClose}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          {needsYou ? (
            <button
              type="button"
              onClick={() => setNeedsYou(false)}
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
          <button
            type="button"
            onClick={onClose}
            aria-label="Close activity"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Close size={16} />
          </button>
        </div>

        <div className="flex items-center gap-1.5 border-b border-border px-5 py-3">
          <ActivityFilterBar
            filters={filters}
            onToggleChannelType={toggleChannelType}
            onChangeState={changeState}
            onReset={() => setFilters(defaultActivityFilters())}
            filtered={filtered}
          />
          {!needsYou && dismissible.length > 0 && (
            <button
              type="button"
              onClick={() => {
                for (const item of dismissible) sticky.drop(item.id);
                dismiss(dismissible);
              }}
              title="Hides these from Activity. Nothing is resolved or marked read; running work stays."
              className="ml-auto shrink-0 text-sm text-accent transition-colors hover:text-accent/80"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4">
          {!needsYou && approvals.length > 0 && (
            <button
              type="button"
              onClick={() => setNeedsYou(true)}
              data-testid="needs-you-summary"
              className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-left transition-colors hover:bg-warning/10 dark:border-warning/20 dark:bg-warning/10 dark:hover:bg-warning/15"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 dark:bg-warning/20">
                <Warning size={16} className="text-warning" />
              </div>
              <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                {approvals.length}{" "}
                {approvals.length === 1 ? "approval" : "approvals"} waiting
              </p>
            </button>
          )}
          {loadingFeed && shown.length === 0 ? (
            <FeedCardSkeleton rows={3} />
          ) : shown.length === 0 ? (
            needsYou ? (
              <ActivityEmpty
                filtered={filtered}
                onReset={() => setNeedsYou(false)}
                offerWayBack
                emptyMessage="Nothing is waiting on you."
                resetLabel="Back to Activity"
              />
            ) : (
              <ActivityEmpty
                filtered={filtered}
                onReset={() => setFilters(defaultActivityFilters())}
              />
            )
          ) : (
            <>
              {loadingFeed && <FeedCardSkeleton />}
              <FeedList
                items={shown}
                agents={agents}
                onOpenSession={(agentId, sessionId) => {
                  onClose();
                  openAgentSession(agentId, sessionId);
                }}
                onDismiss={(item) => {
                  sticky.drop(item.id);
                  dismiss([item]);
                }}
                onResolved={(item, label) => sticky.keep(item, label)}
                resolvedLabelFor={sticky.labelFor}
                artifactsFor={artifactsFor}
                onOpenArtifact={setPreviewArtifactId}
              />
            </>
          )}
        </div>
      </Drawer>

      {previewArtifactId &&
        (previewArtifact ? (
          <ArtifactPreviewDialog
            artifact={previewArtifact}
            onClose={() => setPreviewArtifactId(null)}
          />
        ) : (
          <Modal
            widthClass="w-[860px]"
            onClose={() => setPreviewArtifactId(null)}
          >
            <DialogHeader
              title={previewFailed ? "Couldn't load the artifact" : "Loading…"}
              onClose={() => setPreviewArtifactId(null)}
            />
          </Modal>
        ))}
    </>
  );
}

function Drawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useBodyScrollLock();
  return createPortal(
    <div className="fixed inset-0 z-overlay flex justify-end">
      <button
        type="button"
        aria-label="Close activity"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Activity"
        className={cn(
          "relative flex h-full w-full max-w-[520px] flex-col border-l border-border bg-background shadow-xl",
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function NotificationsBell({ onOpen }: { onOpen: () => void }) {
  const waiting = useWaitingApprovals().length;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="open-activity"
      aria-label={
        waiting > 0 ? `Activity, ${String(waiting)} waiting on you` : "Activity"
      }
      className="relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Activity size={16} />
      {waiting > 0 && (
        <Badge
          variant="warning"
          data-testid="activity-badge"
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full border-0 px-1 text-[10px] font-bold"
        >
          {waiting > 9 ? "9+" : waiting}
        </Badge>
      )}
    </button>
  );
}

function ActivityEmpty({
  filtered,
  onReset,
  offerWayBack = false,
  emptyMessage = "You're all caught up.",
  resetLabel = "Reset to default",
}: {
  filtered: boolean;
  onReset: () => void;
  offerWayBack?: boolean;
  emptyMessage?: string;
  resetLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        {filtered ? "Nothing matches your filters." : emptyMessage}
      </p>
      {(filtered || offerWayBack) && (
        <button
          type="button"
          onClick={onReset}
          className="mt-1 text-sm text-accent transition-colors hover:text-accent/80"
        >
          {resetLabel}
        </button>
      )}
    </div>
  );
}
