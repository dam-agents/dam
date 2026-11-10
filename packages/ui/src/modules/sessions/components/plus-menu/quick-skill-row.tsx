import type { Skill } from "api-server-api";

import { ToggleRow } from "@/components/ui/toggle-row";

import type { SkillsSurface } from "../../../sandboxes/hooks/use-skills-surface.js";
import { selectionKey } from "../../../sandboxes/lib/skill-identity.js";

export function QuickSkillRow({
  skill,
  surface,
  readOnly,
}: {
  skill: Skill;
  surface: SkillsSurface;
  readOnly: boolean;
}) {
  const on = surface.installedRef(skill) !== undefined;
  const busy = surface.busyKey === selectionKey(skill);
  return (
    <ToggleRow
      title={skill.name}
      description={
        skill.description && (
          <span className="line-clamp-2">{skill.description}</span>
        )
      }
      label={`${skill.name} skill`}
      checked={on}
      disabled={readOnly || surface.mutationsDisabled || busy}
      onCheckedChange={() => void surface.toggle(skill)}
    />
  );
}
