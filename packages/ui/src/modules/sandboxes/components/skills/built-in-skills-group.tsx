import type { LocalSkill } from "api-server-api";

import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

import { LocalSkillRow } from "./local-skill-row.js";

export function BuiltInSkillsGroup({
  skills,
  onOpenSkill,
}: {
  skills: LocalSkill[];
  onOpenSkill?: (skill: LocalSkill) => void;
}) {
  return (
    <section>
      <div className="mb-3">
        <SectionLabel>Included with sandbox image</SectionLabel>
      </div>
      <Card>
        {skills.map((skill, i) => (
          <LocalSkillRow
            key={`${skill.skillPath}::${skill.name}`}
            skill={skill}
            withDivider={i > 0}
            onOpen={onOpenSkill ? () => onOpenSkill(skill) : undefined}
          />
        ))}
      </Card>
    </section>
  );
}
