import { useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { ToolChip as T } from "../../../types.js";
import { ActivityBlock } from "./activity-block.js";

export function stripFences(text: string): string {
  return text.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
}

export function ToolContentBlock({ text }: { text: string }) {
  const stripped = stripFences(text);

  return (
    <div className="group/content relative my-1 rounded bg-muted/40 border border-border/40 p-2">
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-words overflow-x-auto w-full leading-[1.5] m-0 pr-6 select-text text-foreground/90">
        {stripped}
      </pre>
      <CopyButton
        value={stripped}
        label="Copy output"
        stopPropagation
        className={cn("absolute right-1 top-1", HOVER_ACTION)}
      />
    </div>
  );
}

export function ToolChip({ chip }: { chip: T }) {
  const [open, setOpen] = useState(false);
  const running = chip.status === "in_progress" || chip.status === "running";

  return (
    <ActivityBlock
      className={chip.status === "failed" ? "text-danger" : undefined}
      label={
        <span className="flex items-start gap-1.5 min-w-0 flex-1">
          {running && (
            <Spinner size={12} className="text-inherit shrink-0 mt-1" />
          )}
          <span
            className={cn(
              "min-w-0 select-text",
              open ? "whitespace-pre-wrap break-words" : "truncate",
            )}
            title={chip.title}
          >
            {chip.title}
          </span>
        </span>
      }
      onToggle={() => setOpen((o) => !o)}
      open={open}
      actions={
        <CopyButton
          value={chip.title}
          label="Copy step"
          stopPropagation
          className={HOVER_ACTION}
        />
      }
    >
      {chip.content?.map((c, i) =>
        c.text ? <ToolContentBlock key={i} text={c.text} /> : null,
      )}
    </ActivityBlock>
  );
}
