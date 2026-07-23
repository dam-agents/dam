import type { LocalSkill, SkillPublishRecord } from "api-server-api";
import {
  Download,
  ExternalLink,
  GitPullRequest,
  MoreHorizontal,
} from "lucide-react";
import type { ReactNode } from "react";

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
 * "In review" pill once it has a publish record). The kebab's Download/Delete
 * are shown disabled — no download/delete-local backend yet (deferred). There
 * is no install toggle: standalone skills are simply present on disk.
 */
export function StandaloneSkillsGroup({
  skills,
  readOnly,
  publishes,
  canPublish,
  onPublish,
  action,
}: {
  skills: LocalSkill[];
  readOnly: boolean;
  publishes: SkillPublishRecord[];
  /** Whether any publishable (GitHub) source exists to publish into. */
  canPublish: boolean;
  onPublish: (skill: LocalSkill) => void;
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
                <p className="truncate text-[13px] text-muted-foreground">
                  only in this sandbox
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
                {/* Download and Delete have no backend yet (deferred) — shown
                    disabled so the affordance is visible without dead actions. */}
                <DropdownMenuContent>
                  <DropdownMenuItem disabled>
                    <Download size={14} />
                    <span className="flex-1">Download skill</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem tone="danger" disabled>
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
