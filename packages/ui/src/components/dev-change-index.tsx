import { useState } from "react";

interface ReviewItem {
  label: string;
  where: string;
  howToReach?: string;
}

const REVIEW_ITEMS: ReviewItem[] = [
  {
    label: "Approval summary banner",
    where: "Yellow bar above the feed",
    howToReach: "Visible on Home when pending approvals exist",
  },
  {
    label: "Approvals detail page",
    where: "Full page with pending + expired cards",
    howToReach: "Click the yellow approval banner",
  },
  {
    label: "Allow / Deny actions",
    where: "Action buttons on each approval card",
    howToReach: "On the approvals detail page, each pending card has actions",
  },
  {
    label: "Back to feed",
    where: "Arrow button top-left of approvals page",
    howToReach: "Click the back arrow on the approvals detail page",
  },
  {
    label: "Date section headers",
    where: "Today / Yesterday / Last 7 days / Last 30 days",
    howToReach: "Scroll the feed — each group has a section label",
  },
  {
    label: "Schedule group card",
    where: "Collapsed card for 7 linkcheck runs",
    howToReach: "In the Today section — shows 'N runs · latest Xm ago'",
  },
  {
    label: "Filter dropdown",
    where: "Trigger says 'All' above the feed",
    howToReach: "Click 'All' to open the two-facet checkbox menu",
  },
  {
    label: "Filter: State facet",
    where: "In progress / Unread checkboxes",
    howToReach: "Inside the filter dropdown under 'State'",
  },
  {
    label: "Filter: Category facet",
    where: "Chats / Experiments / Scheduled / Channels / Terminal",
    howToReach: "Inside the filter dropdown under 'Where it came from'",
  },
  {
    label: "Empty state: all filters off",
    where: "'Nothing included' message",
    howToReach: "Uncheck 'All' in the filter so everything is off",
  },
  {
    label: "Empty state: all clear",
    where: "'All clear' message",
    howToReach: "Dismiss all visible feed cards",
  },
  {
    label: "Clock times on cards",
    where: "e.g. '2:47 PM' instead of '4 min ago'",
    howToReach: "Look at the time on any feed card or approval card",
  },
  {
    label: "Stats line",
    where: "'N running · N to review' next to filter",
    howToReach: "Visible when feed has items",
  },
  {
    label: "Floating approval pill (other pages)",
    where: "Bottom-right pill when not on Home",
    howToReach: "Navigate to any agent — pill shows if pending approvals exist",
  },
  {
    label: "Layout toggle (Feed / Combined)",
    where: "Top-right of home page, next to greeting",
    howToReach: "Click 'Combined' to switch to the agent-grouped layout",
  },
  {
    label: "Widget banner with full visuals",
    where: "Compute bar + spend bars + schedule rows in 3-column grid",
    howToReach:
      "Switch to Combined layout — banner has real charts, period selector, toggles",
  },
  {
    label: "Agent cards (combined mode)",
    where: "Each agent in a bordered card with sessions as subtle rows inside",
    howToReach:
      "Switch to Combined — date sections contain agent cards, not flat lists",
  },
  {
    label: "Feed reorder (feed mode)",
    where: "Filters+stats row above 'Needs attention' approval banner",
    howToReach:
      "In Feed layout: filter row is at top, then approval row, then Today",
  },
  {
    label: "Approval label change",
    where:
      "'Needs attention · N pending' instead of 'N approvals need attention'",
    howToReach: "Visible on both layouts when pending approvals exist",
  },
];

export function DevChangeIndex() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<number>>(() => new Set());

  if (!import.meta.env.VITE_MOCK) return null;

  const toggle = (i: number) =>
    setSeen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="fixed right-4 bottom-4 z-[9999] flex size-10 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold shadow-lg transition-colors hover:bg-muted"
        title="Review checklist"
      >
        {open ? "×" : `${seen.size}/${REVIEW_ITEMS.length}`}
      </button>

      {open && (
        <div className="fixed right-4 bottom-16 z-[9999] max-h-[80vh] w-[380px] overflow-y-auto rounded-xl border border-border bg-background shadow-2xl">
          <div className="sticky top-0 border-b border-border bg-background px-4 py-3">
            <p className="text-sm font-semibold text-foreground">
              Review checklist
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {seen.size} of {REVIEW_ITEMS.length} reviewed — click to mark seen
            </p>
          </div>
          <div className="p-2">
            {REVIEW_ITEMS.map((item, i) => (
              <button
                key={item.label}
                type="button"
                onClick={() => toggle(i)}
                className={`flex w-full gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted ${
                  seen.has(i) ? "opacity-50" : ""
                }`}
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-border text-[10px]">
                  {seen.has(i) ? "✓" : ""}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium ${
                      seen.has(i)
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                    }`}
                  >
                    {item.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.where}</p>
                  {item.howToReach && (
                    <p className="mt-0.5 text-xs italic text-muted-foreground/70">
                      {item.howToReach}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
