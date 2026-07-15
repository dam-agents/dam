import type { Skill, SkillRef, SkillSource } from "api-server-api";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { skillKey } from "../../hooks/use-skills-surface.js";
import { SkillRow } from "./skill-row.js";
import { SkillRowsSkeleton } from "./skills-skeleton.js";

/** Strip the scheme and trailing `.git` so a repo reads as `host/org/repo`. */
function repoLabel(source: SkillSource): string {
  const base = source.gitUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");
  return source.path ? `${base} · ${source.path}` : base;
}

/** Splits a scan/publish error into its message and an optional call-to-action
 *  URL, which the services encode as `\nplatform-cta:<url>` (not connected /
 *  access not granted / repo not allow-listed). */
function SourceError({ error }: { error: string }) {
  const cta = error.match(/platform-cta:(\S+)/)?.[1];
  const message = error.replace(/\nplatform-cta:\S+/, "").trim();
  return (
    <div className="flex items-center gap-2 border-t border-border bg-danger-light px-4 py-2 text-[13px] text-danger">
      <span className="flex-1">{message}</span>
      {cta && (
        <a
          href={cta}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 font-semibold underline hover:opacity-80"
        >
          Fix it →
        </a>
      )}
    </div>
  );
}

/**
 * A single Skill Source rendered as a card: header (name · `N of M on` · repo
 * URL) over its skill rows. Enabled skills sort to the top; when a source has
 * both enabled and available skills the available ones collapse under an
 * "Expand all" / "Hide available" control (slice 02). Source-admin actions (03)
 * and drift (06) attach here in later slices.
 */
export function SkillSourceCard({
  source,
  skills,
  loading,
  error,
  installedRef,
  busyKey,
  disabled,
  stateLoaded,
  readOnly,
  onToggle,
}: {
  source: SkillSource;
  /** `undefined` until this source's scan resolves — distinct from an empty
   *  array (loaded, genuinely no skills), so we skeleton instead of flashing
   *  "No skills". */
  skills: Skill[] | undefined;
  loading: boolean;
  error: string | null;
  installedRef: (source: string, name: string) => SkillRef | undefined;
  busyKey: string | null;
  disabled: boolean;
  /** Whether the installed set has loaded — gates the collapse-default snapshot. */
  stateLoaded: boolean;
  /** Read-only (agent stopped): render the card on a muted background. */
  readOnly: boolean;
  onToggle: (skill: Skill) => void;
}) {
  const busy = loading || skills === undefined;
  const list = skills ?? [];
  const enabled = list.filter(
    (s) => installedRef(s.source, s.name) !== undefined,
  );
  const available = list.filter(
    (s) => installedRef(s.source, s.name) === undefined,
  );
  // Enabled skills sit at the top; available follow in scan order.
  const sorted = [...enabled, ...available];
  const collapsible = enabled.length > 0 && available.length > 0;

  // Snapshot the default collapse once the installed set is known: a source
  // with enabled skills opens collapsed (enabled only). Snapshotting — rather
  // than deriving live — keeps an immediate toggle from collapsing the list
  // mid-edit; it re-snapshots when the card remounts (nav away / refresh).
  const defaultCollapsedRef = useRef<boolean | null>(null);
  if (defaultCollapsedRef.current === null && !busy && stateLoaded) {
    defaultCollapsedRef.current = collapsible;
  }
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded =
    userExpanded ??
    (defaultCollapsedRef.current === null
      ? true
      : !defaultCollapsedRef.current);

  // Collapsed shows enabled only; otherwise the full sorted list. Gating on
  // `collapsible` means a source that drops to zero enabled (or zero available)
  // can't get stuck showing an empty collapsed list with no way to expand.
  const visible = collapsible && !expanded ? enabled : sorted;

  return (
    <div
      className={cn(
        "rounded-lg border border-border",
        readOnly ? "bg-muted" : "bg-card",
      )}
    >
      <div className="flex items-start gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-foreground">
              {source.name}
            </p>
            {!busy && !error && (
              <span className="shrink-0 text-[13px] text-muted-foreground">
                {enabled.length} of {list.length} on
              </span>
            )}
          </div>
          <p className="truncate text-[13px] text-muted-foreground">
            {repoLabel(source)}
          </p>
        </div>
      </div>

      {busy && !error && <SkillRowsSkeleton />}
      {!busy && error && <SourceError error={error} />}
      {!busy && !error && list.length === 0 && (
        <p className="border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
          No skills in this source.
        </p>
      )}
      {!busy &&
        !error &&
        visible.map((skill) => (
          <SkillRow
            key={skillKey(skill.source, skill.name)}
            skill={skill}
            installed={installedRef(skill.source, skill.name) !== undefined}
            busy={busyKey === skillKey(skill.source, skill.name)}
            disabled={disabled}
            onToggle={() => onToggle(skill)}
          />
        ))}

      {!busy && !error && collapsible && (
        <button
          type="button"
          onClick={() => setUserExpanded(!expanded)}
          className="flex w-full items-center gap-1 border-t border-border px-4 py-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? "Hide available" : "Expand all"}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
    </div>
  );
}
