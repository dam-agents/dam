import type { LocalSkill } from "api-server-api";
import type { ReactNode } from "react";

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
  action,
}: {
  skills: LocalSkill[];
  readOnly: boolean;
  /** Header-right slot (e.g. the "+ Add source" button). */
  action?: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionLabel>Created in this sandbox</SectionLabel>
        {action}
      </div>
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
