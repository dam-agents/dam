import { Close } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import type { MockChangesData } from "./mock-changes-card.js";

interface Props {
  changes: MockChangesData;
  onClose: () => void;
}

const MOCK_FILES = [
  {
    path: "src/auth/login.ts",
    status: "modified" as const,
    additions: 42,
    deletions: 8,
  },
  {
    path: "src/auth/session.ts",
    status: "modified" as const,
    additions: 31,
    deletions: 5,
  },
  {
    path: "src/routes/api.ts",
    status: "modified" as const,
    additions: 28,
    deletions: 3,
  },
  {
    path: "src/types/user.ts",
    status: "added" as const,
    additions: 19,
    deletions: 2,
  },
];

export function MockDockedChangesPanel({ changes, onClose }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="flex-1 text-sm font-medium text-foreground">
          Changes
        </span>
        <span className="text-xs text-muted-foreground">
          {changes.repo} &middot; {changes.branch}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          tooltip="Close"
          onClick={onClose}
        >
          <Close size={16} />
        </Button>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span>{changes.filesChanged} files changed</span>
        <span className="font-mono tabular-nums">
          <span className="text-success">+{changes.additions}</span>{" "}
          <span className="text-danger">&minus;{changes.deletions}</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col">
          {MOCK_FILES.map((file) => (
            <div
              key={file.path}
              className="flex items-center gap-2 border-b border-border/50 px-3 py-2"
            >
              <span
                className={
                  file.status === "added"
                    ? "text-2xs font-medium text-success"
                    : "text-2xs font-medium text-warning"
                }
              >
                {file.status === "added" ? "A" : "M"}
              </span>
              <span className="flex-1 min-w-0 truncate font-mono text-xs text-foreground">
                {file.path}
              </span>
              <span className="font-mono text-2xs tabular-nums shrink-0">
                <span className="text-success">+{file.additions}</span>{" "}
                <span className="text-danger">&minus;{file.deletions}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="p-3 space-y-3">
          {MOCK_FILES.map((file) => (
            <div
              key={file.path}
              className="rounded-md border border-border overflow-hidden"
            >
              <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 border-b border-border">
                <span className="font-mono text-xs text-foreground truncate">
                  {file.path}
                </span>
              </div>
              <div className="px-3 py-2 text-xs text-muted-foreground font-mono leading-relaxed">
                <div className="text-success">
                  + // {file.status === "added" ? "new file" : "updated"}{" "}
                  implementation
                </div>
                <div className="text-danger">- // previous version</div>
                <div className="text-muted-foreground/50">
                  &nbsp;&nbsp;// ... ({file.additions + file.deletions} lines
                  changed)
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
