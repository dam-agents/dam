import { cn } from "@/lib/utils";

import { scrollToFileDiff } from "../lib/diff-layout.js";
import type { FileDiff } from "../types.js";
import { DiffStatText } from "./diff-stat-text.js";
import { FileStatusMark } from "./file-status-mark.js";

export function ChangedFileList({ files }: { files: FileDiff[] }) {
  return (
    <div className="border-b border-border">
      <div className="px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          Changed files
        </span>
      </div>
      <div className="max-h-40 overflow-y-auto">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => scrollToFileDiff(file.path)}
            className={cn(
              "flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs transition-colors hover:bg-muted",
            )}
          >
            <FileStatusMark
              status={file.status}
              uncommitted={file.uncommitted}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-foreground">
              {file.path}
            </span>
            {!file.binary && (
              <DiffStatText
                additions={file.additions}
                deletions={file.deletions}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
