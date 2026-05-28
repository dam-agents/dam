import {
  Checkmark as Check,
  ChevronDown,
  ChevronRight,
  Close as X,
  Renew as Loader,
} from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { ToolChip as T } from "../../../types.js";

const statusColor: Record<string, string> = {
  pending: "text-muted-foreground",
  in_progress: "text-warning",
  running: "text-warning",
  completed: "text-success",
  failed: "text-destructive",
};

function stripFences(text: string): string {
  return text.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
}

const statusIcon = (status: string) => {
  if (status === "completed") return <Check size={12} className="shrink-0" />;
  if (status === "failed") return <X size={12} className="shrink-0" />;
  if (status === "in_progress" || status === "running")
    return <Loader size={11} className="anim-spin shrink-0" />;
  return null;
};

export function ToolChip({ chip }: { chip: T }) {
  const [open, setOpen] = useState(false);
  const hasContent = chip.content && chip.content.length > 0;
  const color = statusColor[chip.status] ?? statusColor.pending;

  return (
    <div className="text-[12px] max-w-full">
      <Button
        variant="outline"
        size="sm"
        className={`h-auto gap-1.5 py-1 px-2 font-medium ${color} max-w-full ${hasContent ? "cursor-pointer" : "cursor-default"}`}
        onClick={hasContent ? () => setOpen((o) => !o) : undefined}
      >
        {hasContent ? (
          open ? (
            <ChevronDown size={12} className="shrink-0" />
          ) : (
            <ChevronRight size={12} className="shrink-0" />
          )
        ) : null}
        {statusIcon(chip.status)}
        <span className="font-semibold truncate">{chip.title}</span>
      </Button>
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
    </div>
  );
}
