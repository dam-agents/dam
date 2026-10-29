import { Settings } from "@carbon/icons-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { useDevToolsState } from "./dev-tools-state.js";

const CHANGES_STATES = ["loading", "done", "error", "pr-open"] as const;
const PROCESS_STATES = [
  "running",
  "finished",
  "failed",
  "restart-waiting",
] as const;
const BROWSER_STATES = [
  "starting",
  "loading",
  "ready",
  "error",
  "failed",
  "unavailable",
  "disconnected",
  "agent-asleep",
  "multi-tab",
] as const;
const ENV_STATES = ["starting", "running", "expired", "deleted"] as const;

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "bg-muted text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

export function DevToolsToggle() {
  const [open, setOpen] = useState(false);
  const state = useDevToolsState();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "fixed bottom-4 right-16 z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted",
          open && "bg-muted",
        )}
        aria-label="Dev tools state toggle"
      >
        <Settings size={16} className="text-foreground" />
      </button>
      {open && (
        <div className="fixed bottom-16 right-16 z-[9999] w-72 rounded-lg border border-border bg-card p-3 shadow-xl">
          <div className="mb-2 text-[12px] font-semibold text-foreground">
            Dev Tools State
          </div>

          <Row
            label="Changes"
            states={CHANGES_STATES}
            value={state.changesStatus}
            onChange={state.setChangesStatus}
          />
          <Row
            label="Process"
            states={PROCESS_STATES}
            value={state.processStatus}
            onChange={state.setProcessStatus}
          />
          <Row
            label="Browser"
            states={BROWSER_STATES}
            value={state.browserStatus}
            onChange={state.setBrowserStatus}
          />
          <Row
            label="Environment"
            states={ENV_STATES}
            value={state.environmentStatus}
            onChange={state.setEnvironmentStatus}
          />
        </div>
      )}
    </>
  );
}

function Row<T extends string>({
  label,
  states,
  value,
  onChange,
}: {
  label: string;
  states: readonly T[];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">
        <Chip
          label="default"
          active={value === null}
          onClick={() => onChange(null)}
        />
        {states.map((s) => (
          <Chip
            key={s}
            label={s}
            active={value === s}
            onClick={() => onChange(value === s ? null : s)}
          />
        ))}
      </div>
    </div>
  );
}
