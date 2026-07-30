import type { LocalSkill, SkillPublishRecord } from "api-server-api";
import {
  Download,
  ExternalLink,
  GitPullRequest,
  MoreHorizontal,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";

import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionLabel } from "@/components/ui/section-label";
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
        <p className="text-[13px] text-muted-foreground">
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
          <p className="text-[13px] text-muted-foreground">
            No skills created in this sandbox yet. Drop a .md file here, or ask
            the agent to author one.
          </p>
        </div>
      </Callout>
    </section>
  );
}

/** Latest publish record per skill name — drives the "In review" pill. */
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
 * uploaded as Markdown. Each row can be published upstream as a PR (or shows an
 * "In review" pill once it has a publish record), and the kebab downloads or
 * deletes it. There is no install toggle: standalone skills are simply present
 * on disk.
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
      <div
        className={cn(
          "rounded-lg border border-border",
          readOnly ? "bg-muted" : "bg-card",
        )}
      >
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
                    "truncate text-[13px] text-muted-foreground",
                    !skill.description && "italic",
                  )}
                >
                  {skill.description || "No description"}
                </p>
              </div>

              {pub ? (
                <a
                  href={pub.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-info-light px-2.5 py-1 text-[12px] font-medium text-info transition-opacity hover:opacity-80"
                  title={`Pull request open on ${pub.sourceName}`}
                >
                  <GitPullRequest size={13} /> In review · {pub.sourceName}
                </a>
              ) : (
                <button
                  type="button"
                  disabled={!canPublish}
                  onClick={() => onPublish(skill)}
                  title={
                    canPublish
                      ? "Publish this skill as a pull request"
                      : "Add a GitHub source first to publish there"
                  }
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Publish <ExternalLink size={13} />
                </button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Skill actions"
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <MoreHorizontal size={18} />
                  </button>
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
      </div>
    </section>
  );
}
