import type { LocalSkill } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { HintTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Image-shipped Local Skills, split out of "Created in this sandbox"
 *  (#2828). Read-only — publish is also blocked server-side. */
export function BuiltInSkillsGroup({ skills }: { skills: LocalSkill[] }) {
  return (
    <section>
      <div className="mb-3">
        <SectionLabel>Included with sandbox image</SectionLabel>
      </div>
      <Card>
        {skills.map((skill, i) => (
          <BuiltInSkillRow
            key={`${skill.skillPath}::${skill.name}`}
            skill={skill}
            withDivider={i > 0}
          />
        ))}
      </Card>
    </section>
  );
}

/** Pilled when the on-disk copy has diverged from the image. */
function BuiltInSkillRow({
  skill,
  withDivider,
}: {
  skill: LocalSkill;
  withDivider: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3",
        withDivider && "border-t border-border",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-foreground">
          {skill.name}
        </p>
        <p
          className={cn(
            "truncate text-sm text-muted-foreground",
            !skill.description && "italic",
          )}
        >
          {skill.description || "No description"}
        </p>
      </div>
      {skill.origin === "system-modified" && (
        <HintTooltip
          label="Modified"
          content="This skill's files differ from the copy shipped in the sandbox image"
          className="shrink-0"
        >
          <Badge variant="warning">Modified</Badge>
        </HintTooltip>
      )}
    </div>
  );
}
