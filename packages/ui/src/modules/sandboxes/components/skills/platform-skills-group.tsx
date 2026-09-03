import type { LocalSkill, PlatformFeatureId } from "api-server-api";
import { platformSkillFeature } from "api-server-api";

import { Badge } from "@/components/ui/badge";

import type { SandboxSection } from "../../../platform/lib/routes.js";
import { LocalSkillsGroup } from "./local-skills-group.js";

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
  const featureBadge = (skill: LocalSkill) => {
    const feature = platformSkillFeature(skill);
    if (!feature) return undefined;

    const badge = <Badge variant="info">{feature.label}</Badge>;
    const section = FEATURE_SECTION[feature.id];
    if (!section || !onOpenSection) {
      return <span className="shrink-0">{badge}</span>;
    }
    return (
      <button
        type="button"
        onClick={() => onOpenSection(section)}
        className="shrink-0 hover:opacity-80"
        title={`Open ${feature.label}`}
      >
        {badge}
      </button>
    );
  };

  return (
    <LocalSkillsGroup
      label="From platform features"
      description="The platform ships these so a feature works. They are managed for you — you cannot edit or delete them here."
      skills={skills}
      onOpenSkill={onOpenSkill}
      trailingFor={featureBadge}
    />
  );
}
