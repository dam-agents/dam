import type { PlatformFeatureId } from "api-server-api";
import { platformSkillsForFeature } from "api-server-api";

import { cn } from "@/lib/utils";

function separator(index: number, total: number): string {
  if (index === 0) return "";
  return index === total - 1 ? " and " : ", ";
}

export function PlatformSkillNote({
  featureId,
  subject = "this agent",
  className,
  onOpenSkills,
}: {
  featureId: PlatformFeatureId;
  subject?: string;
  className?: string;
  onOpenSkills?: () => void;
}) {
  const names = platformSkillsForFeature(featureId);
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
      {names.length > 1 ? "skills" : "skill"} to {subject}.
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
