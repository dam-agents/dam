import { Checkmark, Copy, Warning } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Spinner } from "@/components/ui/spinner";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

import type { ToolChip as T } from "../../../types.js";
import { ActivityBlock } from "./activity-block.js";

export function stripFences(text: string): string {
  return text.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
}

export function ToolContentBlock({ text }: { text: string }) {
  const { copy, copied, state } = useCopy();
  const stripped = stripFences(text);

  return (
    <div className="group/content relative my-1 rounded bg-muted/40 border border-border/40 p-2">
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-words overflow-x-auto w-full leading-[1.5] m-0 pr-6 select-text text-foreground/90">
        {stripped}
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? "Copied" : "Copy output"}
        tooltip={copied ? "Copied" : "Copy output"}
        onClick={(e) => {
          e.stopPropagation();
          void copy(stripped);
        }}
        className={cn(
          "absolute right-1 top-1 text-muted-foreground hover:text-foreground",
          HOVER_ACTION,
          copied && "text-success hover:text-success opacity-100",
          state === "failed" && "text-danger hover:text-danger opacity-100",
        )}
      >
        {copied ? (
          <Checkmark size={12} />
        ) : state === "failed" ? (
          <Warning size={12} />
        ) : (
          <Copy size={12} />
        )}
      </Button>
    </div>
  );
}

export function ToolChip({ chip }: { chip: T }) {
  const [open, setOpen] = useState(false);
  const { copy, copied, state: copyState } = useCopy();
  const running = chip.status === "in_progress" || chip.status === "running";

  return (
    <ActivityBlock
      className={chip.status === "failed" ? "text-destructive" : undefined}
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
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={copied ? "Copied" : "Copy step"}
          tooltip={copied ? "Copied" : "Copy step"}
          onClick={(e) => {
            e.stopPropagation();
            void copy(chip.title);
          }}
          className={cn(
            "text-muted-foreground hover:text-foreground",
            HOVER_ACTION,
            copied && "text-success hover:text-success opacity-100",
            copyState === "failed" &&
              "text-danger hover:text-danger opacity-100",
          )}
        >
          {copied ? (
            <Checkmark size={12} />
          ) : copyState === "failed" ? (
            <Warning size={12} />
          ) : (
            <Copy size={12} />
          )}
        </Button>
      }
    >
      {chip.content?.map((c, i) =>
        c.text ? <ToolContentBlock key={i} text={c.text} /> : null,
      )}
    </ActivityBlock>
  );
}
