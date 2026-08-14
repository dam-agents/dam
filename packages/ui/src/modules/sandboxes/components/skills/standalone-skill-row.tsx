import {
  Download,
  Export,
  OverflowMenuHorizontal,
  Renew,
  TrashCan,
  View,
} from "@carbon/icons-react";
import type { LocalSkill, SkillPublishRecord } from "api-server-api";

import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { externalLinkProps } from "@/lib/external-link";
import { formatDateTime } from "@/lib/format-time";
import { cn } from "@/lib/utils";

const PR_STATE_PILL: Record<
  NonNullable<SkillPublishRecord["prState"]> | "unknown",
  { label: string; variant: "info" | "success" | "muted" }
> = {
  draft: { label: "Draft", variant: "muted" },
  open: { label: "Open", variant: "info" },
  merged: { label: "Merged", variant: "success" },
  closed: { label: "Closed", variant: "muted" },
  unknown: { label: "Submitted", variant: "muted" },
};

export function StandaloneSkillRow({
  skill,
  publish,
  divided,
  readOnly,
  canPublish,
  onPublish,
  onDownload,
  onDelete,
  onTrack,
  onOpen,
  trackUnavailable,
}: {
  skill: LocalSkill;
  publish?: SkillPublishRecord;
  divided: boolean;
  readOnly: boolean;
  canPublish: boolean;
  onPublish: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onTrack?: () => void;
  onOpen?: () => void;
  trackUnavailable?: boolean;
}) {
  const pill = PR_STATE_PILL[publish?.prState ?? "unknown"];
  const canRepublish = !publish || publish.prState === "closed";

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2",
        divided && "border-t border-border",
      )}
    >
      <div className="min-w-0 flex-1">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="max-w-full truncate text-left text-[15px] font-medium text-foreground hover:underline"
          >
            {skill.name}
          </button>
        ) : (
          <p className="truncate text-[15px] font-medium text-foreground">
            {skill.name}
          </p>
        )}
      </div>

      {publish && (
        <Tooltip
          content={`Published to ${publish.sourceName} on ${formatDateTime(
            publish.publishedAt,
          )} — opens the pull request`}
        >
          <a
            href={publish.prUrl}
            {...externalLinkProps}
            className={cn(
              badgeVariants({ variant: pill.variant }),
              "shrink-0 font-medium transition-opacity hover:opacity-80",
              readOnly && "border-border",
            )}
          >
            {pill.label}
          </a>
        </Tooltip>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Skill actions"
            className="shrink-0 text-muted-foreground"
          >
            <OverflowMenuHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {onOpen && (
            <DropdownMenuItem onSelect={onOpen}>
              <View size={14} />
              <span className="flex-1">Preview SKILL.md</span>
            </DropdownMenuItem>
          )}
          {publish?.prState === "merged" && onTrack && (
            <DropdownMenuItem
              disabled={trackUnavailable}
              onSelect={onTrack}
              title={
                trackUnavailable
                  ? `${publish.sourceName} hasn't been scanned yet, so this skill's published version isn't known`
                  : undefined
              }
            >
              <Renew size={14} />
              <span className="flex-1">Track from {publish.sourceName}</span>
            </DropdownMenuItem>
          )}
          {}
          {canRepublish && (
            <DropdownMenuItem
              disabled={!canPublish}
              onSelect={onPublish}
              title={
                canPublish
                  ? undefined
                  : "Add a GitHub source first to publish there"
              }
            >
              <Export size={14} />
              <span className="flex-1">
                {publish ? "Publish again…" : "Publish…"}
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onDownload}>
            <Download size={14} />
            <span className="flex-1">Download skill</span>
          </DropdownMenuItem>
          <DropdownMenuItem tone="danger" onSelect={onDelete}>
            <TrashCan size={14} />
            <span className="flex-1">Delete skill</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
