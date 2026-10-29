import { LogoGithub } from "@carbon/icons-react";

import { Spinner } from "@/components/ui/spinner";

import { useDevToolsState } from "../../../../mock/dev-tools-state.js";
import { useStore } from "../../../../store.js";
import type { WorkChanges } from "../../../../types.js";
import { WorkCardShell } from "./work-card-shell.js";

export function ChangesCard({ part }: { part: WorkChanges }) {
  const setOpenChangesData = useStore((s) => s.setOpenChangesData);
  const devOverride = useDevToolsState((s) => s.changesStatus);
  const status =
    (import.meta.env.VITE_MOCK ? devOverride : null) ?? part.status ?? "done";

  if (status === "loading") {
    return (
      <WorkCardShell
        title="Analyzing changes…"
        accessory={<Spinner size={14} />}
      />
    );
  }

  if (status === "error") {
    return (
      <WorkCardShell
        title="Changes"
        detail={part.summary || "Failed to load changes."}
        accessory={
          <span className="rounded-full bg-[#dc2626]/10 px-2 py-0.5 text-[10px] font-bold text-[#dc2626]">
            Error
          </span>
        }
      />
    );
  }

  const totalInsertions = part.files.reduce((a, f) => a + f.insertions, 0);
  const totalDeletions = part.files.reduce((a, f) => a + f.deletions, 0);

  return (
    <WorkCardShell
      title={`${part.files.length} file${part.files.length !== 1 ? "s" : ""} changed`}
      detail={part.summary}
      accessory={
        status === "pr-open" && part.pullRequestUrl ? (
          <a
            href={part.pullRequestUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <LogoGithub size={16} />
          </a>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums">
            <span className="text-[#24a148]">+{totalInsertions}</span>
            <span className="text-[#dc2626]">-{totalDeletions}</span>
          </span>
        )
      }
      onClick={() =>
        setOpenChangesData({
          files: part.files,
          summary: part.summary,
          selectedFile: part.files[0]?.path ?? null,
        })
      }
    />
  );
}
