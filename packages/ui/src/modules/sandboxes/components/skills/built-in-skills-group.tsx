import type { LocalSkill } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

/** Image-shipped Local Skills, split out of "Created in this sandbox"
 *  (#2828). Read-only — publish is also blocked server-side. */
export function BuiltInSkillsGroup({
  skills,
  onOpenSkill,
}: {
  skills: LocalSkill[];
  /** Open a skill's SKILL.md preview. Absent when there is no pod to read
   *  the file from, which leaves the names inert. */
  onOpenSkill?: (skill: LocalSkill) => void;
}) {
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
            onOpen={onOpenSkill ? () => onOpenSkill(skill) : undefined}
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
  onOpen,
}: {
  skill: LocalSkill;
  withDivider: boolean;
  onOpen?: () => void;
}) {
  return (
    <div
      className={cn(
        // Same rhythm as the other two groups' rows: three lists that read as
        // one surface, rather than three that were styled on different days.
        "flex items-center gap-3 px-4 py-2",
        withDivider && "border-t border-border",
      )}
    >
      <div className="min-w-0 flex-1">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="max-w-full truncate text-left text-[15px] font-medium text-foreground hover:underline"
          >
            {skill.name}
          </button>
        ) : (
          <p className="truncate text-[15px] font-medium text-foreground">
            {skill.name}
          </p>
        )}
      </div>
      {skill.origin === "system-modified" && (
        <Badge
          variant="warning"
          className="shrink-0"
          title="This skill's files differ from the copy shipped in the sandbox image"
        >
          Modified
        </Badge>
      )}
    </div>
  );
}
