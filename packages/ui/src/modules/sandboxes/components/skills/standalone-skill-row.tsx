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

/**
 * The label answers "is this skill published upstream?", not "what happened to
 * the pull request?" — so a merged one reads `Published`, which is precisely why
 * an unresolved one cannot: it would conflate "definitely in the catalog" with
 * "no idea" (#3019).
 */
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

/**
 * One Standalone Local Skill: the name, the publish pill once it has a publish
 * record, and the kebab. The pill's label is a function of the pull request's
 * resolved state, so it stays true after a merge or a close.
 *
 * The row carries no description and no inline buttons — every action lives in
 * the kebab, so five rows read as a list rather than as five control panels.
 * The description is one click away in the drawer.
 *
 * Publishing is offered when there is no record at all, and again only in the
 * `closed` state — where nothing landed, so the local copy is all there is.
 * Not for `draft`/`open` (a live pull request exists and publish mints a fresh
 * branch rather than updating it), nor `merged` (the next step is tracking it
 * from the source, not maintaining an untracked fork), nor `unknown` (no basis
 * to reason).
 */
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
  /** Latest publish record for this skill, when it has ever been published. */
  publish?: SkillPublishRecord;
  /** Draw the separator — every row but the first. */
  divided: boolean;
  /** Agent stopped/starting: the card behind the row is `bg-muted`, which a
   *  muted pill would otherwise disappear into. */
  readOnly: boolean;
  /** Whether any publishable (GitHub) source exists to publish into. */
  canPublish: boolean;
  onPublish: () => void;
  onDownload: () => void;
  onDelete: () => void;
  /** Hand the skill over to its source, so it becomes governed by the normal
   *  source → install → drift → Update loop. Offered only once merged. */
  onTrack?: () => void;
  /** Open the skill's SKILL.md render modal. Makes the name clickable; absent
   *  when there is no pod to read the file from. */
  onOpen?: () => void;
  /** The source hasn't been scanned yet (or is unreachable), so we can't tell
   *  whether the local copy diverged — disable rather than guess. */
  trackUnavailable?: boolean;
}) {
  const pill = PR_STATE_PILL[publish?.prState ?? "unknown"];
  const canRepublish = !publish || publish.prState === "closed";

  return (
    <div
      className={cn(
        // py-2, not py-3: the 28px kebab sets the row height, so this is what
        // lands the row on the design's 44px.
        "flex items-center gap-3 px-4 py-2",
        divided && "border-t border-border",
      )}
    >
      <div className="min-w-0 flex-1">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            /* max-w-full, not min-w-0: an inline-block button in a block
               parent would otherwise size to its nowrap text and overflow. */
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
        // The bare state label, per the design. The source and the date moved
        // into the tooltip, which already named both — the row says what
        // happened, the tooltip says where and when.
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
          {/* Disabled rather than hidden when there is nowhere to publish: the
              action exists, it is the sandbox that is missing a GitHub source,
              and the tooltip is the only place that can say so. */}
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
