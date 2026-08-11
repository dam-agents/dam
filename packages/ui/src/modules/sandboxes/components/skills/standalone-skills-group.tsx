import { Upload } from "@carbon/icons-react";
import type { LocalSkill, SkillPublishRecord } from "api-server-api";
import type { ReactNode } from "react";

import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { StandaloneSkillRow } from "./standalone-skill-row.js";

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

/** Latest publish record per skill name — drives the publish pill. */
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
 * uploaded as Markdown. Each row can be published upstream as a PR, shows a pill
 * reporting that PR's state once it has a publish record, and offers a kebab to
 * download or delete it. There is no install toggle: standalone skills are
 * simply present on disk.
 *
 * The per-row rendering lives in {@link StandaloneSkillRow}; this component owns
 * only the section, the header slot, and which publish record belongs to which
 * skill.
 */
export function StandaloneSkillsGroup({
  skills,
  readOnly,
  publishes,
  canPublish,
  onPublish,
  onDownload,
  onDelete,
  onTrack,
  onOpenSkill,
  trackUnavailableNames,
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
  /** Hand a merged skill over to its source. */
  onTrack: (skill: LocalSkill, publish: SkillPublishRecord) => void;
  /** Open a skill's SKILL.md preview. Absent when there is no pod to read
   *  the file from, which leaves the names inert. */
  onOpenSkill?: (skill: LocalSkill) => void;
  /** Names whose source hasn't been scanned, so tracking can't be offered yet. */
  trackUnavailableNames: ReadonlySet<string>;
}) {
  const published = latestPublishByName(publishes);

  return (
    <section>
      <div className="mb-3">
        <SectionLabel>Created in this sandbox</SectionLabel>
      </div>
      <Card className={cn(readOnly && "bg-muted")}>
        {skills.map((skill, i) => {
          const pub = published.get(skill.name);
          return (
            <StandaloneSkillRow
              key={`${skill.skillPath}::${skill.name}`}
              skill={skill}
              publish={pub}
              divided={i > 0}
              canPublish={canPublish}
              onPublish={() => onPublish(skill)}
              onDownload={() => onDownload(skill)}
              onDelete={() => onDelete(skill, pub)}
              onTrack={pub ? () => onTrack(skill, pub) : undefined}
              onOpen={onOpenSkill ? () => onOpenSkill(skill) : undefined}
              trackUnavailable={trackUnavailableNames.has(skill.name)}
            />
          );
        })}
      </Card>
    </section>
  );
}
