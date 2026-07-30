import { Compare, Renew } from "@carbon/icons-react";
import type { Skill } from "api-server-api";

import { badgeVariants } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * One skill inside a source card: name (+ drift "Update" affordance) and
 * description on the left, an immediate install/uninstall toggle on the right.
 * Clicking the name opens the SKILL.md render modal (05). A drifted installed
 * skill flags an "Update" pill that re-installs at the latest version (06).
 */
export function SkillRow({
  skill,
  installed,
  busy,
  disabled,
  hasDrift,
  compareUrl,
  onToggle,
  onUpdate,
  onOpen,
}: {
  skill: Skill;
  installed: boolean;
  busy: boolean;
  disabled: boolean;
  /** Installed content differs from the latest scan (06). */
  hasDrift: boolean;
  /** GitHub compare view (installed → latest), when drift is on a git host. */
  compareUrl: string | null;
  onToggle: () => void;
  onUpdate: () => void;
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
        <div className="flex items-center gap-2">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="min-w-0 truncate text-left text-[15px] font-medium text-foreground hover:underline"
            >
              {skill.name}
            </button>
          ) : (
            <p className="min-w-0 truncate text-[15px] font-medium text-foreground">
              {skill.name}
            </p>
          )}
          {hasDrift && (
            <button
              type="button"
              onClick={onUpdate}
              disabled={disabled}
              title="Upstream changed since install — update to the latest version"
              className={cn(
                badgeVariants({ variant: "info", size: "sm" }),
                "shrink-0 gap-1 px-2 text-[11px] transition-opacity hover:opacity-80 disabled:opacity-50",
              )}
            >
              <Renew size={11} /> Update
            </button>
          )}
          {hasDrift && compareUrl && (
            <a
              href={compareUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="View changes on GitHub"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Compare size={13} />
            </a>
          )}
        </div>
        {skill.description && (
          <p
            className="truncate text-[13px] text-muted-foreground"
            title={skill.description}
          >
            {skill.description}
          </p>
        )}
      </div>
      {busy && <Spinner />}
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
