import type { LocalSkill } from "api-server-api";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { ListSection } from "@/components/ui/list-section";

function LocalSkillRow({
  skill,
  onOpen,
  trailing,
  wholeRow = false,
}: {
  skill: LocalSkill;
  onOpen?: () => void;
  trailing?: ReactNode;
  wholeRow?: boolean;
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
  if (onOpen && !wholeRow)
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
  // UNIT_BOUNDARY_DESCRIPTION: under the experiment the whole row opens the skill's info, not only its name, so a reader with a mouse or a screen reader has one target for the whole list item.
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`About ${skill.name}`}
      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-3 px-4 py-3">{body}</div>
  );
}

export function LocalSkillsGroup({
  label,
  description,
  skills,
  onOpenSkill,
  trailingFor,
  wholeRows = false,
}: {
  label: string;
  description?: ReactNode;
  skills: LocalSkill[];
  onOpenSkill?: (skill: LocalSkill) => void;
  trailingFor?: (skill: LocalSkill) => ReactNode;
  wholeRows?: boolean;
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
          wholeRow={wholeRows}
        />
      ))}
    </ListSection>
  );
}
