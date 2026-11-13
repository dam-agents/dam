import { Badge } from "@/components/ui/badge";

import { useStore } from "../../../../store.js";
import type { WorkChanges } from "../../../../types.js";
import {
  type PullRequestStatus,
  pullRequestStatus,
} from "../../../changes/lib/pull-request-state.js";
import { WorkCardShell } from "./work-card-shell.js";

export function ChangesCard({ part }: { part: WorkChanges }) {
  const setOpenChangesData = useStore((s) => s.setOpenChangesData);

  const totalInsertions = part.files.reduce((a, f) => a + f.insertions, 0);
  const totalDeletions = part.files.reduce((a, f) => a + f.deletions, 0);
  const fileCount = part.files.length;

  const prStatus: PullRequestStatus | null = part.pullRequest
    ? pullRequestStatus(part.pullRequest)
    : null;

  const detail = [part.repository, part.branch].filter(Boolean).join(" · ");

  return (
    <WorkCardShell
      title={`${fileCount} file${fileCount !== 1 ? "s" : ""} changed`}
      detail={detail || part.summary}
      accessory={
        prStatus ? (
          <Badge variant={prStatus.variant} size="sm">
            <span className={prStatus.struck ? "line-through" : ""}>
              #{part.pullRequest!.number}
            </span>
            {prStatus.label && <span className="ml-1">{prStatus.label}</span>}
          </Badge>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums">
            <span className="text-[#24a148] dark:text-[#42be65]">
              +{totalInsertions}
            </span>
            <span className="text-[#dc2626] dark:text-[#fa4d56]">
              -{totalDeletions}
            </span>
          </span>
        )
      }
      onClick={() =>
        setOpenChangesData({
          files: part.files,
          summary: part.summary,
          selectedFile: part.files[0]?.path ?? null,
          changeSetPath: null,
        })
      }
    />
  );
}
