import type { LocalSkill } from "api-server-api";

import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

/**
 * "Built into this sandbox" — Local Skills the sandbox image shipped
 * (`origin: system` / `system-modified`), segregated from the user's own so
 * "Created in this sandbox" only shows what the user actually authored
 * (#2828). Read-only: no publish (blocked server-side too) and no kebab —
 * these skills are the image's, not the user's. A `system-modified` row is
 * pilled: its on-disk copy has diverged from the image (an edit here, or a
 * template upgrade moving the image ahead).
 */
export function BuiltInSkillsGroup({ skills }: { skills: LocalSkill[] }) {
  return (
    <section>
      <div className="mb-3">
        <SectionLabel>Built into this sandbox</SectionLabel>
      </div>
      <div className="rounded-lg border border-border bg-muted">
        {skills.map((skill, i) => (
          <div
            key={`${skill.skillPath}::${skill.name}`}
            className={cn(
              "flex items-center gap-3 px-4 py-3",
              i > 0 && "border-t border-border",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium text-foreground">
                {skill.name}
              </p>
              <p
                className={cn(
                  "truncate text-[13px] text-muted-foreground",
                  !skill.description && "italic",
                )}
              >
                {skill.description || "No description"}
              </p>
            </div>
            {skill.origin === "system-modified" && (
              <span
                className="inline-flex shrink-0 items-center rounded-full bg-warning/15 px-2.5 py-1 text-[12px] font-medium text-warning"
                title="This skill's files differ from the copy shipped in the sandbox image"
              >
                Modified
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
