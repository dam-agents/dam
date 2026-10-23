import type { FileChangeStatus, FileDiff } from "agent-runtime-api";

import { cn } from "@/lib/utils";

const MARKS: Record<FileChangeStatus, { letter: string; className: string }> = {
  added: { letter: "A", className: "text-success" },
  deleted: { letter: "D", className: "text-danger" },
  modified: { letter: "M", className: "text-warning" },
  renamed: { letter: "R", className: "text-accent" },
};

export function FileStatusMark({ file }: { file: FileDiff }) {
  const mark = MARKS[file.status];
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span
        className={cn("w-3.5 font-mono text-xs font-semibold", mark.className)}
        title={file.status}
      >
        {mark.letter}
      </span>
      {file.uncommitted && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-warning"
          aria-label="Uncommitted"
          title="Uncommitted"
        />
      )}
    </span>
  );
}
