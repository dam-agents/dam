import type { LocalSkill } from "api-server-api";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

function LocalSkillRow({
  skill,
  withDivider,
  onOpen,
  trailing,
}: {
  skill: LocalSkill;
  withDivider: boolean;
  onOpen?: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
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
      {trailing}
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
