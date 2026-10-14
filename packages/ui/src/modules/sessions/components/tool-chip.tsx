import { lazy, Suspense, useState } from "react";

import { ErrorBoundary } from "@/components/error-boundary";
import { CopyButton } from "@/components/ui/copy-button";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { ToolChip as T, ToolContent } from "../../../types.js";
import { ActivityBlock } from "./activity-block.js";

export function stripFences(text: string): string {
  return text.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
}

const OUTPUT_PREVIEW_LINES = 40;

export function ToolContentBlock({ text }: { text: string }) {
  const stripped = stripFences(text);
  const [showAll, setShowAll] = useState(false);
  const lines = stripped.replace(/\n$/, "").split("\n");
  const clipped = lines.length > OUTPUT_PREVIEW_LINES;
  const shown =
    clipped && !showAll
      ? lines.slice(0, OUTPUT_PREVIEW_LINES).join("\n")
      : stripped;

  return (
    <div className="group/content relative my-1 rounded bg-muted/40 border border-border/40 p-2">
      <pre className="text-2xs font-mono whitespace-pre-wrap break-words overflow-x-auto w-full leading-[1.5] m-0 pr-6 select-text text-foreground/90">
        {shown}
      </pre>
      {clipped && (
        <div className="-mx-2 -mb-2 mt-2 border-t border-border px-2 py-1.5 text-2xs">
          <button
            type="button"
            onClick={() => setShowAll((all) => !all)}
            className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
          >
            {showAll ? "Show less" : `Show all ${lines.length} lines`}
          </button>
        </div>
      )}
      <CopyButton
        value={stripped}
        label="Copy output"
        stopPropagation
        className={cn("absolute right-1 top-1", HOVER_ACTION)}
      />
    </div>
  );
}

const ToolDiffBlock = lazy(() =>
  import("./tool-diff-block.js").then((m) => ({ default: m.ToolDiffBlock })),
);

export function ToolContentList({
  content,
}: {
  content: ToolContent[] | undefined;
}) {
  return content?.map((c, i) =>
    c.type === "diff" ? (
      <ErrorBoundary key={i} fallback={<ToolContentBlock text={c.newText} />}>
        <Suspense fallback={<ToolContentBlock text={c.newText} />}>
          <ToolDiffBlock
            path={c.path}
            oldText={c.oldText}
            newText={c.newText}
          />
        </Suspense>
      </ErrorBoundary>
    ) : (
      <ToolContentBlock key={i} text={c.text} />
    ),
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
      <ToolContentList content={chip.content} />
    </ActivityBlock>
  );
}
