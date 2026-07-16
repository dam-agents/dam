import type { Skill } from "api-server-api";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * One skill inside a source card: name + description on the left, an immediate
 * install/uninstall toggle on the right. Later slices hang the drift "Update"
 * affordance (06) and a name-click render modal (05) off this row.
 */
export function SkillRow({
  skill,
  installed,
  busy,
  disabled,
  onToggle,
  onOpen,
}: {
  skill: Skill;
  installed: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
  /** Open the skill's SKILL.md render modal (05). Makes the name clickable. */
  onOpen?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t border-border px-4 py-3",
        installed && "bg-muted/30",
      )}
    >
      <div className="min-w-0 flex-1">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full truncate text-left text-[15px] font-medium text-foreground hover:underline"
          >
            {skill.name}
          </button>
        ) : (
          <p className="truncate text-[15px] font-medium text-foreground">
            {skill.name}
          </p>
        )}
        {skill.description && (
          <p
            className="truncate text-[13px] text-muted-foreground"
            title={skill.description}
          >
            {skill.description}
          </p>
        )}
      </div>
      {busy && (
        <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground" />
      )}
      <Switch
        checked={installed}
        onCheckedChange={onToggle}
        label={`${installed ? "Uninstall" : "Install"} ${skill.name}`}
        testId={`skill-toggle-${skill.name}`}
        className={cn(disabled && "pointer-events-none opacity-50")}
      />
    </div>
  );
}
