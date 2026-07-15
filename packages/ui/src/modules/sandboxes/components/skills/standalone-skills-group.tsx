import type { LocalSkill } from "api-server-api";

import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

/**
 * "Created in this sandbox" — Standalone Local Skills authored in place, tracked
 * in no source. Publish, Delete, and the render modal attach in slices 04/05;
 * this slice renders just the group card and its rows.
 */
export function StandaloneSkillsGroup({
  skills,
  readOnly,
}: {
  skills: LocalSkill[];
  readOnly: boolean;
}) {
  return (
    <section>
      <SectionLabel spaced>Created in this sandbox</SectionLabel>
      <div
        className={cn(
          "rounded-lg border border-border",
          readOnly ? "bg-muted" : "bg-card",
        )}
      >
        {skills.map((skill, i) => (
          <div
            key={`${skill.skillPath}::${skill.name}`}
            className={cn("px-4 py-3", i > 0 && "border-t border-border")}
          >
            <p className="truncate text-[15px] font-medium text-foreground">
              {skill.name}
            </p>
            <p className="text-[13px] text-muted-foreground">
              only in this sandbox
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
