import type { LocalSkill } from "api-server-api";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

import { LocalSkillRow } from "./local-skill-row.js";

export function LocalSkillsGroup({
  label,
  description,
  skills,
  onOpenSkill,
  trailingFor,
}: {
  label: string;
  description?: ReactNode;
  skills: LocalSkill[];
  onOpenSkill?: (skill: LocalSkill) => void;
  trailingFor?: (skill: LocalSkill) => ReactNode;
}) {
  return (
    <section>
      <div className="mb-3">
        <SectionLabel>{label}</SectionLabel>
      </div>
      {description && (
        <p className="mb-3 text-sm text-muted-foreground">{description}</p>
      )}
      <Card>
        {skills.map((skill, i) => (
          <LocalSkillRow
            key={`${skill.skillPath}::${skill.name}`}
            skill={skill}
            withDivider={i > 0}
            onOpen={onOpenSkill ? () => onOpenSkill(skill) : undefined}
            trailing={trailingFor?.(skill)}
          />
        ))}
      </Card>
    </section>
  );
}
