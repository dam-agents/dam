import type { LocalSkill } from "api-server-api";

import { LocalSkillsGroup } from "./local-skills-group.js";

export function BuiltInSkillsGroup({
  skills,
  onOpenSkill,
}: {
  skills: LocalSkill[];
  onOpenSkill?: (skill: LocalSkill) => void;
}) {
  return (
    <LocalSkillsGroup
      label="Included with sandbox image"
      skills={skills}
      onOpenSkill={onOpenSkill}
    />
  );
}
