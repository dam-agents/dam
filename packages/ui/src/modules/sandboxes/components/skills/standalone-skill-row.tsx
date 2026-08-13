import {
  Download,
  Launch,
  OverflowMenuHorizontal,
  PullRequest,
  Renew,
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
  { label: string; variant: "outline" | "info" | "success" | "muted" }
> = {
  draft: { label: "Draft", variant: "outline" },
  open: { label: "In review", variant: "info" },
  merged: { label: "Published", variant: "success" },
  closed: { label: "Closed", variant: "muted" },
  unknown: { label: "Submitted", variant: "muted" },
};

export function StandaloneSkillRow({
  skill,
  publish,
  divided,
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
        "flex items-center gap-3 px-4 py-3",
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
        <p
          className={cn(
            "truncate text-sm text-muted-foreground",
            !skill.description && "italic",
          )}
        >
          {skill.description || "No description"}
        </p>
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
              "shrink-0 gap-1.5 border-border font-medium transition-opacity hover:opacity-80",
            )}
          >
            <PullRequest size={13} /> {pill.label} · {publish.sourceName}
          </a>
        </Tooltip>
      )}

      {canRepublish && (
        <Button
          variant="outline"
          size="xs"
          disabled={!canPublish}
          onClick={onPublish}
          tooltip={
            canPublish
              ? "Publish this skill as a pull request"
              : "Add a GitHub source first to publish there"
          }
          className="shrink-0 gap-1.5"
        >
          {publish ? "Publish again" : "Publish"} <Launch size={13} />
        </Button>
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
          <DropdownMenuItem onSelect={onDownload}>
            <Download size={14} />
            <span className="flex-1">Download skill</span>
          </DropdownMenuItem>
          <DropdownMenuItem tone="danger" onSelect={onDelete}>
            Delete skill
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
