import type { LocalSkill } from "api-server-api";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { ListSection } from "@/components/ui/list-section";

function LocalSkillRow({
  skill,
  onOpen,
  trailing,
}: {
  skill: LocalSkill;
  onOpen?: () => void;
  trailing?: ReactNode;
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-md font-medium text-foreground">
          {skill.name}
        </p>
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
    </>
  );
  if (onOpen)
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpen}
            className="max-w-full truncate text-left text-md font-medium text-foreground hover:underline"
          >
            {skill.name}
          </button>
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
  return <div className="flex items-center gap-3 px-4 py-3">{body}</div>;
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
    <ListSection
      label={label}
      description={description}
      className="mb-0"
      isEmpty={false}
      empty={null}
    >
      {skills.map((skill) => (
        <LocalSkillRow
          key={`${skill.skillPath}::${skill.name}`}
          skill={skill}
          onOpen={onOpenSkill ? () => onOpenSkill(skill) : undefined}
          trailing={trailingFor?.(skill)}
        />
      ))}
    </ListSection>
  );
}
