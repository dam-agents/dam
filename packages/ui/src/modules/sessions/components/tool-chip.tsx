import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { useState } from "react";

import type { ToolChip as T } from "../../../types.js";

const dotColor: Record<string, string> = {
  pending: "bg-muted-foreground",
  in_progress: "bg-emerald-400",
  running: "bg-emerald-400",
  pending_approval: "bg-warning",
  completed: "bg-emerald-400",
  failed: "bg-destructive",
};

function stripFences(text: string): string {
  return text.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
}

export function ToolChip({ chip }: { chip: T }) {
  const [open, setOpen] = useState(false);
  const hasContent = chip.content && chip.content.length > 0;
  const dot = dotColor[chip.status] ?? dotColor.pending;
  const isPendingApproval = chip.status === "pending_approval";

  return (
    <div className="text-[13px] max-w-full">
      <button
        type="button"
        className={`inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] text-foreground/80 max-w-full transition-colors ${hasContent ? "cursor-pointer hover:bg-muted/50" : "cursor-default"}`}
        onClick={hasContent ? () => setOpen((o) => !o) : undefined}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        {hasContent &&
          (open ? (
            <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight
              size={11}
              className="shrink-0 text-muted-foreground"
            />
          ))}
        <span className="truncate">{chip.title}</span>
      </button>
      {open && chip.content && (
        <div className="mt-1 rounded-lg bg-muted border border-border overflow-hidden">
          {chip.content.map((c, i) =>
            c.text ? (
              <pre
                key={i}
                className="px-3 py-1.5 text-[11px] font-mono text-foreground/80 whitespace-pre-wrap break-words overflow-x-auto w-full leading-[1.5]"
              >
                {stripFences(c.text)}
              </pre>
            ) : null,
          )}
        </div>
      )}
      {isPendingApproval && (
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-warning">
          <span className="w-2.5 h-2.5 rounded-full bg-warning animate-pulse shrink-0" />
          <span className="font-medium">
            Waiting for your approval to proceed
          </span>
        </div>
      )}
    </div>
  );
}
