import { Document } from "@carbon/icons-react";
import type { LocalSkill, SkillPublishRecord } from "api-server-api";

import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { StandaloneSkillRow } from "./standalone-skill-row.js";

export function StandaloneSkillsEmptyState() {
  return (
    <section>
      <SectionLabel spaced>Created in this sandbox</SectionLabel>
      <Callout variant="dashed">
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <Document size={20} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No skills created in this sandbox yet. Drop a .md file here, or ask
            the agent to author one.
          </p>
        </div>
      </Callout>
    </section>
  );
}

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
  canPublish: boolean;
  onPublish: (skill: LocalSkill) => void;
  onDownload: (skill: LocalSkill) => void;
  onDelete: (skill: LocalSkill, publish?: SkillPublishRecord) => void;
  onTrack: (skill: LocalSkill, publish: SkillPublishRecord) => void;
  onOpenSkill?: (skill: LocalSkill) => void;
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
              readOnly={readOnly}
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
