import type { PlatformFeatureId } from "api-server-api";

import { cn } from "@/lib/utils";

const SKILLS: readonly [string, PlatformFeatureId][] = [
  ["platform-schedules", "schedules"],
  ["spawn-subagent", "invocations"],
  ["platform-models", "connections"],
  ["platform-github", "connections"],
  ["platform-s3", "connections"],
  ["platform-chat-forms", "chat-forms"],
];

function separator(index: number, total: number): string {
  if (index === 0) return "";
  return index === total - 1 ? " and " : ", ";
}

// UNIT_BOUNDARY_DESCRIPTION: the sentence that names the platform skills a section's feature adds. api-server-api no longer exports the skill list, so the web app keeps its own copy of the skill names and the feature each belongs to.
export function PlatformSkillNote({
  featureId,
  className,
  onOpenSkills,
}: {
  featureId: PlatformFeatureId;
  className?: string;
  onOpenSkills?: () => void;
}) {
  const names = SKILLS.filter(([, id]) => id === featureId).map(
    ([name]) => name,
  );
  if (names.length === 0) return null;

  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      Adds the{" "}
      {names.map((name, i) => (
        <span key={name}>
          {separator(i, names.length)}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{name}</code>
        </span>
      ))}{" "}
      {names.length > 1 ? "skills" : "skill"} to this agent.
      {onOpenSkills && (
        <>
          {" "}
          <button
            type="button"
            onClick={onOpenSkills}
            className="underline underline-offset-2 hover:text-foreground"
          >
            View in Skills
          </button>
        </>
      )}
    </p>
  );
}
