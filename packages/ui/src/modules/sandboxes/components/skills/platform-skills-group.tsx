import type { LocalSkill, PlatformFeatureId } from "api-server-api";
import { platformSkillFeature } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

import type { SandboxSection } from "../../../platform/lib/routes.js";
import { LocalSkillRow } from "./local-skill-row.js";

const FEATURE_SECTION: Partial<Record<PlatformFeatureId, SandboxSection>> = {
  schedules: "schedules",
  connections: "connections",
};

export function PlatformSkillsGroup({
  skills,
  onOpenSkill,
  onOpenSection,
}: {
  skills: LocalSkill[];
  onOpenSkill?: (skill: LocalSkill) => void;
  onOpenSection?: (section: SandboxSection) => void;
}) {
  return (
    <section>
      <div className="mb-3">
        <SectionLabel>From platform features</SectionLabel>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        The platform ships these so a feature works. They are managed for you —
        you cannot edit or delete them here.
      </p>
      <Card>
        {skills.map((skill, i) => {
          const feature = platformSkillFeature(skill);
          const section = feature ? FEATURE_SECTION[feature.id] : undefined;
          return (
            <LocalSkillRow
              key={`${skill.skillPath}::${skill.name}`}
              skill={skill}
              withDivider={i > 0}
              onOpen={onOpenSkill ? () => onOpenSkill(skill) : undefined}
              trailing={
                feature ? (
                  section && onOpenSection ? (
                    <button
                      type="button"
                      onClick={() => onOpenSection(section)}
                      className="shrink-0"
                      title={`Open ${feature.label}`}
                    >
                      <Badge variant="info" className="hover:opacity-80">
                        {feature.label}
                      </Badge>
                    </button>
                  ) : (
                    <Badge variant="info" className="shrink-0">
                      {feature.label}
                    </Badge>
                  )
                ) : undefined
              }
            />
          );
        })}
      </Card>
    </section>
  );
}
