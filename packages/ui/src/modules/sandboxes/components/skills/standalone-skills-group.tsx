import { Add } from "@carbon/icons-react";
import type { LocalSkill, SkillPublishRecord } from "api-server-api";

import { AddRow, ListSection } from "@/components/ui/list-section";

import {
  latestPublishByName,
  type ReadyTrackTarget,
  type TrackTarget,
} from "./publish-target.js";
import { StandaloneSkillRow } from "./standalone-skill-row.js";

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
  trackTargets,
  onUpload,
}: {
  skills: LocalSkill[];
  readOnly: boolean;
  publishes: SkillPublishRecord[];
  canPublish: boolean;
  onPublish: (skill: LocalSkill) => void;
  onDownload: (skill: LocalSkill) => void;
  onDelete: (skill: LocalSkill, publish?: SkillPublishRecord) => void;
  onTrack: (skill: LocalSkill, target: ReadyTrackTarget) => void;
  onOpenSkill?: (skill: LocalSkill) => void;
  trackTargets: ReadonlyMap<string, TrackTarget>;
  onUpload?: () => void;
}) {
  const published = latestPublishByName(publishes);

  return (
    <ListSection
      label="Created in this agent"
      className="mb-0"
      onNew={onUpload}
      newLabel="Upload"
      newTestId="skills-upload"
      isEmpty={skills.length === 0}
      empty="No skills created in this agent yet. Upload or drop a .md file here, or ask the agent to author one."
      addRow={
        onUpload && (
          <AddRow onClick={onUpload} testId="skills-upload">
            <Add size={16} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-md font-medium text-foreground">
                Upload a skill
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Drop a .md file here, or ask the agent to author one.
              </p>
            </div>
          </AddRow>
        )
      }
    >
      {skills.map((skill) => {
        const pub = published.get(skill.name);
        return (
          <StandaloneSkillRow
            key={`${skill.skillPath}::${skill.name}`}
            skill={skill}
            publish={pub}
            readOnly={readOnly}
            canPublish={canPublish}
            onPublish={() => onPublish(skill)}
            onDownload={() => onDownload(skill)}
            onDelete={() => onDelete(skill, pub)}
            onTrack={(target) => onTrack(skill, target)}
            onOpen={onOpenSkill ? () => onOpenSkill(skill) : undefined}
            trackTarget={trackTargets.get(skill.name)}
          />
        );
      })}
    </ListSection>
  );
}
