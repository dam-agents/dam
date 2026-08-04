import {
  Download,
  Launch,
  OverflowMenuHorizontal,
  PullRequest,
  Upload,
} from "@carbon/icons-react";
import type { LocalSkill, SkillPublishRecord } from "api-server-api";
import type { ReactNode } from "react";

import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";
import { externalLinkProps } from "@/lib/external-link";
import { formatDateTime } from "@/lib/format-time";
import { cn } from "@/lib/utils";

/**
 * Stopped/starting counterpart to {@link StandaloneSkillsGroup}. The standalone
 * list is read live from the pod's PVC (`listLocal`), so it's unavailable while
 * the agent is hibernated — `skills.state` returns an empty standalone list. We
 * still render the section (header + explanatory placeholder) rather than
 * dropping it, so it stays present and read-only in parity with the GitHub
 * group instead of vanishing (#944 review).
 */
export function StandaloneSkillsPlaceholder() {
  return (
    <section>
      <div className="mb-3">
        <SectionLabel>Created in this sandbox</SectionLabel>
      </div>
      <div className="rounded-lg border border-border bg-muted px-4 py-6">
        <p className="text-sm text-muted-foreground">
          Skills created in this sandbox appear here once it's running.
        </p>
      </div>
    </section>
  );
}

/** Running-agent empty state (#2828): the section keeps its header and an
 *  authoring affordance instead of vanishing when no user skill exists yet. */
export function StandaloneSkillsEmptyState({ action }: { action?: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionLabel>Created in this sandbox</SectionLabel>
        {action}
      </div>
      <Callout variant="dashed">
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <Upload size={20} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No skills created in this sandbox yet. Drop a .md file here, or ask
            the agent to author one.
          </p>
        </div>
      </Callout>
    </section>
  );
}

/** Latest publish record per skill name — drives the "Published" pill. */
function latestPublishByName(
  publishes: SkillPublishRecord[],
): Map<string, SkillPublishRecord> {
  const map = new Map<string, SkillPublishRecord>();
  for (const p of publishes) {
    const cur = map.get(p.skillName);
    if (!cur || p.publishedAt > cur.publishedAt) map.set(p.skillName, p);
  }
  return map;
}

/**
 * "Created in this sandbox" — Standalone Local Skills authored in place or
 * uploaded as Markdown. Each row can be published upstream as a PR (or shows a
 * "Published" pill once it has a publish record), and the kebab downloads or
 * deletes it. There is no install toggle: standalone skills are simply present
 * on disk.
 *
 * The pill reports the publish *event*, never the PR's state: nothing here
 * re-reads GitHub, so a state claim would go stale the moment the PR is merged
 * or closed (#3019).
 */
export function StandaloneSkillsGroup({
  skills,
  readOnly,
  publishes,
  canPublish,
  onPublish,
  onDownload,
  onDelete,
  action,
}: {
  skills: LocalSkill[];
  readOnly: boolean;
  publishes: SkillPublishRecord[];
  /** Whether any publishable (GitHub) source exists to publish into. */
  canPublish: boolean;
  onPublish: (skill: LocalSkill) => void;
  onDownload: (skill: LocalSkill) => void;
  /** The row's latest publish record is passed along so the confirm dialog can
   *  mention the PR without re-deriving it in the parent. */
  onDelete: (skill: LocalSkill, publish?: SkillPublishRecord) => void;
  /** Header-right slot (e.g. the "+ Add source" button). */
  action?: ReactNode;
}) {
  const published = latestPublishByName(publishes);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionLabel>Created in this sandbox</SectionLabel>
        {action}
      </div>
      <Card className={cn(readOnly && "bg-muted")}>
        {skills.map((skill, i) => {
          const pub = published.get(skill.name);
          return (
            <div
              key={`${skill.skillPath}::${skill.name}`}
              className={cn(
                "flex items-center gap-3 px-4 py-3",
                i > 0 && "border-t border-border",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-foreground">
                  {skill.name}
                </p>
                <p
                  className={cn(
                    "truncate text-sm text-muted-foreground",
                    !skill.description && "italic",
                  )}
                >
                  {skill.description || "No description"}
                </p>
              </div>

              {pub ? (
                <Tooltip
                  content={`Published to ${pub.sourceName} on ${formatDateTime(
                    pub.publishedAt,
                  )} — opens the pull request`}
                >
                  <a
                    href={pub.prUrl}
                    {...externalLinkProps}
                    className={cn(
                      badgeVariants({ variant: "muted" }),
                      // border-border, because the readOnly card is bg-muted too
                      // and the pill would otherwise vanish into it.
                      "shrink-0 gap-1.5 border-border font-medium transition-opacity hover:opacity-80",
                    )}
                  >
                    <PullRequest size={13} /> Published · {pub.sourceName}
                  </a>
                </Tooltip>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!canPublish}
                  onClick={() => onPublish(skill)}
                  tooltip={
                    canPublish
                      ? "Publish this skill as a pull request"
                      : "Add a GitHub source first to publish there"
                  }
                  className="shrink-0 gap-1.5"
                >
                  Publish <Launch size={13} />
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
                  <DropdownMenuItem onSelect={() => onDownload(skill)}>
                    <Download size={14} />
                    <span className="flex-1">Download skill</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    tone="danger"
                    onSelect={() => onDelete(skill, pub)}
                  >
                    Delete skill
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </Card>
    </section>
  );
}
