import { useMemo, useState } from "react";

import { TruncateStart } from "@/components/truncate-start";
import { CopyButton } from "@/components/ui/copy-button";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Spinner } from "@/components/ui/spinner";
import { collapseContext, diffLines, type DiffRow } from "@/lib/line-diff";
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
        <ShowAllToggle
          showAll={showAll}
          total={lines.length}
          onToggle={() => setShowAll((all) => !all)}
        />
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

const DIFF_ROW_STYLE: Record<DiffRow["kind"], string> = {
  context: "text-foreground/70",
  added: "bg-success-light text-foreground",
  removed: "bg-danger-light text-foreground",
  gap: "text-muted-foreground italic",
};

const DIFF_MARKER: Record<DiffRow["kind"], string> = {
  context: " ",
  added: "+",
  removed: "-",
  gap: " ",
};

function ShowAllToggle({
  showAll,
  total,
  onToggle,
}: {
  showAll: boolean;
  total: number;
  onToggle: () => void;
}) {
  return (
    <div className="-mx-2 -mb-2 mt-2 border-t border-border px-2 py-1.5 text-2xs">
      <button
        type="button"
        onClick={onToggle}
        className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
      >
        {showAll ? "Show less" : `Show all ${total} lines`}
      </button>
    </div>
  );
}

export function ToolDiffBlock({
  path,
  oldText,
  newText,
}: {
  path: string;
  oldText: string | null;
  newText: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const lines = useMemo(
    () => diffLines(oldText ?? "", newText),
    [oldText, newText],
  );
  const rows = useMemo(() => collapseContext(lines), [lines]);
  const added = lines.filter((l) => l.kind === "added").length;
  const removed = lines.filter((l) => l.kind === "removed").length;
  const clipped = rows.length > OUTPUT_PREVIEW_LINES;
  const shown =
    clipped && !showAll ? rows.slice(0, OUTPUT_PREVIEW_LINES) : rows;

  return (
    <div className="group/content relative my-1 rounded bg-muted/40 border border-border/40 p-2">
      <div className="flex items-center gap-2 pr-6 pb-1.5 text-2xs font-mono min-w-0">
        <TruncateStart title={path} className="min-w-0 text-foreground/90">
          {path}
        </TruncateStart>
        {oldText === null && (
          <span className="shrink-0 text-muted-foreground">new file</span>
        )}
        <span className="shrink-0 text-success">+{added}</span>
        <span className="shrink-0 text-danger">-{removed}</span>
      </div>
      <pre className="text-2xs font-mono whitespace-pre-wrap break-words overflow-x-auto w-full leading-[1.5] m-0 select-text">
        {shown.map((row, i) => (
          <div key={i} className={cn("flex", DIFF_ROW_STYLE[row.kind])}>
            <span className="select-none w-3 shrink-0 text-center">
              {DIFF_MARKER[row.kind]}
            </span>
            <span className="min-w-0 flex-1">
              {row.kind === "gap"
                ? `${row.count} unchanged ${row.count === 1 ? "line" : "lines"}`
                : row.text || "\u00A0"}
            </span>
          </div>
        ))}
      </pre>
      {clipped && (
        <ShowAllToggle
          showAll={showAll}
          total={rows.length}
          onToggle={() => setShowAll((all) => !all)}
        />
      )}
      <CopyButton
        value={newText}
        label="Copy new content"
        stopPropagation
        className={cn("absolute right-1 top-1", HOVER_ACTION)}
      />
    </div>
  );
}

export function ToolContentList({
  content,
}: {
  content: ToolContent[] | undefined;
}) {
  return content?.map((c, i) =>
    c.type === "diff" ? (
      <ToolDiffBlock
        key={i}
        path={c.path}
        oldText={c.oldText}
        newText={c.newText}
      />
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
