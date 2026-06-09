import { Email as Inbox, Home, Settings } from "@carbon/icons-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../brand.js";
import { useStore } from "../../../store.js";
import { useApprovalsForOwner } from "../../approvals/api/queries.js";
import { ApprovalsList } from "../../approvals/components/approvals-list.js";

const EMPTY: never[] = [];
const COMPACT_LIMIT = 5;

/** Thin left-edge icon rail: brand wordmark + Home at the top, Inbox +
 *  Settings at the bottom. Present on every surface in place of a sidebar. */
export function IconRail() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const atHome =
    view === "new-landing" ||
    view === "new-image" ||
    view === "new-sandbox" ||
    view === "new-connections" ||
    view === "new-context";

  return (
    <nav className="flex w-[56px] shrink-0 flex-col items-center gap-2 bg-background py-3">
      <button
        type="button"
        onClick={() => setView("new-landing")}
        aria-label={getBrand().name}
        className="mb-2 text-[15px] font-bold tracking-tight text-foreground"
      >
        {getBrand().name}
      </button>

      <RailButton
        label="Home"
        active={atHome}
        onClick={() => setView("new-landing")}
      >
        <Home size={18} />
      </RailButton>

      <div className="flex-1" />

      <InboxRailButton active={view === "inbox"} />
      <RailButton
        label="Settings"
        active={view === "settings"}
        onClick={() => setView("settings")}
      >
        <Settings size={18} />
      </RailButton>
    </nav>
  );
}

function InboxRailButton({ active }: { active: boolean }) {
  const setView = useStore((s) => s.setView);
  const { data: rows = EMPTY } = useApprovalsForOwner();
  const pending = rows.filter((r) => r.status === "pending");
  const pendingCount = pending.length;

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <RailButton
        label="Inbox"
        active={active}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="relative">
          <Inbox size={18} />
          {pendingCount > 0 && (
            <Badge
              variant="default"
              className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center border-0"
            >
              {pendingCount > 9 ? "9+" : pendingCount}
            </Badge>
          )}
        </span>
      </RailButton>
      {open && (
        <div className="absolute left-full bottom-0 ml-2 z-40 w-[320px] rounded-lg border border-input bg-card shadow-sm overflow-hidden anim-scale-in">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
              Inbox
            </span>
            <span className="text-[10px] text-muted-foreground">
              {pendingCount} pending
            </span>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            <ApprovalsList
              rows={pending.slice(0, COMPACT_LIMIT)}
              density="compact"
              emptyLabel="Nothing pending"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setView("inbox");
            }}
            className="w-full h-9 border-t border-border rounded-none text-[12px] font-semibold text-primary hover:bg-primary/10"
          >
            See all
          </Button>
        </div>
      )}
    </div>
  );
}

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
        active
          ? "text-primary bg-primary/10"
          : "text-foreground/70 hover:text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
