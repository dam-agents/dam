import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { useState } from "react";

import type { ToolChip as T } from "../../../types.js";

function stripFences(text: string): string {
  return text.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
}

const statusSuffix: Record<string, string | null> = {
  pending: null,
  in_progress: "running…",
  running: "running…",
  pending_approval: "awaiting approval",
  completed: null,
  failed: "failed",
};

export function ToolChip({ chip }: { chip: T }) {
  const [open, setOpen] = useState(false);
  const hasContent = chip.content && chip.content.length > 0;
  const suffix = statusSuffix[chip.status] ?? null;
  const isFailed = chip.status === "failed";

  return (
    <div className="max-w-full">
      <button
        type="button"
        className={`inline-flex items-center gap-1.5 py-0.5 text-[12px] font-mono max-w-full transition-colors ${
          hasContent
            ? "cursor-pointer text-muted-foreground hover:text-foreground"
            : "cursor-default text-muted-foreground"
        }`}
        onClick={hasContent ? () => setOpen((o) => !o) : undefined}
      >
        {hasContent &&
          (open ? (
            <ChevronDown size={11} className="shrink-0 opacity-50" />
          ) : (
            <ChevronRight size={11} className="shrink-0 opacity-50" />
          ))}
        <span className="truncate">{chip.title}</span>
        {suffix && (
          <span
            className={`shrink-0 text-[11px] ${isFailed ? "text-destructive" : "opacity-50"}`}
          >
            — {suffix}
          </span>
        )}
      </button>
      {open && chip.content && (
        <div className="mt-0.5 ml-4 pl-3 overflow-hidden">
          {chip.content.map((c, i) =>
            c.text ? (
              <pre
                key={i}
                className="text-[11px] font-mono text-muted-foreground/70 whitespace-pre-wrap break-words overflow-x-auto w-full leading-[1.5]"
              >
                {stripFences(c.text)}
              </pre>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
