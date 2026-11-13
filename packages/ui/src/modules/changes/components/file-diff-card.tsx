import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import type { DiffLayout } from "../lib/diff-layout.js";
import { fileDiffAnchor } from "../lib/diff-layout.js";
import type { FileDiff } from "../types.js";
import { DiffStatText } from "./diff-stat-text.js";
import { FileStatusMark } from "./file-status-mark.js";
import { MockDiffView } from "./mock-diff-view.js";

const LARGE_DIFF_THRESHOLD = 500;

export function FileDiffCard({
  file,
  layout,
}: {
  file: FileDiff;
  layout: DiffLayout;
}) {
  const isLarge =
    !file.binary &&
    file.patch !== null &&
    file.patch.split("\n").length > LARGE_DIFF_THRESHOLD;
  const [collapsed, setCollapsed] = useState(isLarge);

  return (
    <div
      id={fileDiffAnchor(file.path)}
      className="overflow-hidden rounded-lg border border-border"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 bg-muted/50 px-3 py-2 text-left text-xs hover:bg-muted"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <FileStatusMark status={file.status} uncommitted={file.uncommitted} />
        <span className="min-w-0 flex-1 truncate font-mono text-foreground">
          {file.oldPath && file.oldPath !== file.path
            ? `${file.oldPath} → ${file.path}`
            : file.path}
        </span>
        {!file.binary && (
          <DiffStatText additions={file.additions} deletions={file.deletions} />
        )}
      </button>

      {!collapsed && (
        <div className={cn("overflow-x-auto border-t border-border")}>
          {file.binary ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              Binary file not shown.
            </p>
          ) : file.patch === null ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              Large diff collapsed. Expand it to show.
            </p>
          ) : (
            <MockDiffView patch={file.patch} layout={layout} />
          )}
        </div>
      )}

      {collapsed && isLarge && (
        <div className="border-t border-border px-4 py-2">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="text-xs text-accent hover:underline"
          >
            Large diff collapsed. Expand it to show.
          </button>
        </div>
      )}
    </div>
  );
}
