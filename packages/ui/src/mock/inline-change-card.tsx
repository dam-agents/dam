import { Code, LogoGithub } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import type { ChangeCardAttachment } from "./data/transcripts/tools-demo.js";

interface Props {
  card: ChangeCardAttachment;
  onViewChanges: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
};

const STATUS_COLOR: Record<string, string> = {
  modified: "text-warning",
  added: "text-success",
  deleted: "text-danger",
  renamed: "text-info",
};

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function dirPath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/") + "/";
}

export function InlineChangeCard({ card, onViewChanges }: Props) {
  const totalAdd = card.files.reduce((s, f) => s + f.additions, 0);
  const totalDel = card.files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="my-1 rounded-lg border border-border bg-muted/30">
      <div className="flex items-center gap-2 px-3 py-2">
        <Code size={16} className="shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm text-foreground">
          {card.files.length} file{card.files.length === 1 ? "" : "s"} changed
          <span className="ml-1.5 font-mono text-2xs tabular-nums">
            <span className="text-success">+{totalAdd}</span>{" "}
            <span className="text-danger">&minus;{totalDel}</span>
          </span>
        </span>
        {card.prNumber != null && card.prUrl && (
          <a
            href={card.prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <LogoGithub size={12} />#{card.prNumber}
          </a>
        )}
        <Button variant="outline" size="xs" onClick={onViewChanges}>
          View changes
        </Button>
      </div>

      <div className="border-t border-border px-3 py-1.5">
        {card.files.map((f) => (
          <div key={f.path} className="flex items-center gap-2 py-0.5 text-xs">
            <span
              className={`w-3 shrink-0 text-center font-mono font-medium ${STATUS_COLOR[f.status] ?? "text-muted-foreground"}`}
            >
              {STATUS_LABEL[f.status] ?? "?"}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              <span className="text-muted-foreground/60">
                {dirPath(f.path)}
              </span>
              <span className="text-foreground">{fileName(f.path)}</span>
            </span>
            <span className="shrink-0 font-mono text-2xs tabular-nums">
              {f.additions > 0 && (
                <span className="text-success">+{f.additions}</span>
              )}
              {f.additions > 0 && f.deletions > 0 && " "}
              {f.deletions > 0 && (
                <span className="text-danger">&minus;{f.deletions}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
