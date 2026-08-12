import { Compare } from "@carbon/icons-react";
import type { Skill } from "api-server-api";

import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

const DRIFT_HINT =
  "Upstream changed since install — update to the latest version";

/**
 * One skill inside a source card: the name on the left, and on the right the
 * drift "Update" affordance followed by an immediate install/uninstall toggle.
 * Clicking the name opens the SKILL.md render modal (05). A drifted installed
 * skill offers "Update", which re-installs at the latest version (06).
 *
 * No description: at twenty-odd rows per source it turned the card into a wall
 * of prose, and the drawer behind the name carries it.
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
        "flex items-center gap-3 border-t border-border px-4 py-2",
        installed && "bg-muted/30",
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
      {hasDrift && (
        <Tooltip content={DRIFT_HINT}>
          {/* A text link, not a pill: it sits in the same right-hand rail as
              the toggle, where a filled badge would compete with it for the
              eye on every drifted row. */}
          <button
            type="button"
            onClick={onUpdate}
            disabled={disabled}
            /* A disabled button opens no tooltip, so the hint falls back to
               `title` exactly where "why can't I click this?" is asked. */
            title={disabled ? DRIFT_HINT : undefined}
            className="shrink-0 text-sm font-medium text-accent transition-colors hover:underline disabled:opacity-50"
          >
            Update
          </button>
        </Tooltip>
      )}
      {hasDrift && compareUrl && (
        <Tooltip content="View changes on GitHub">
          <a
            href={compareUrl}
            {...externalLinkProps}
            aria-label="View changes on GitHub"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Compare size={13} />
          </a>
        </Tooltip>
      )}
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
