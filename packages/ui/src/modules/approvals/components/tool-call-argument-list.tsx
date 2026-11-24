import { cn } from "@/lib/utils";

import type { ToolCallArgumentRow } from "../lib/tool-call-argument-rows.js";

function ArgumentRow({ row }: { row: ToolCallArgumentRow }) {
  return (
    <>
      <dt className="font-mono text-xs leading-5 text-muted-foreground break-all">
        {row.name}
      </dt>
      <dd
        className={cn(
          "m-0 max-h-40 min-w-0 overflow-y-auto whitespace-pre-wrap break-words text-foreground",
          row.json && "font-mono text-xs leading-5",
        )}
      >
        {row.value}
      </dd>
    </>
  );
}

export function ToolCallArgumentList({
  rows,
}: {
  rows: readonly ToolCallArgumentRow[];
}) {
  return (
    <dl
      data-testid="tool-call-arguments"
      className="m-0 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm"
    >
      {rows.map((row) => (
        <ArgumentRow key={row.name} row={row} />
      ))}
    </dl>
  );
}
