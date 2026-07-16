import type { Skill, SkillRef, SkillSource } from "api-server-api";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import { useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
 * URL · kebab) over its skill rows. Enabled skills sort to the top and the
 * available ones collapse under an "Expand all" / "Hide available" control.
 * The kebab administers the source (re-scan / view repo / remove); a re-scan
 * shows a header spinner while the rows stay put.
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
  onRescan,
  onRemove,
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
  onRescan: () => void;
  onRemove: () => void;
}) {
  const loaded = skills !== undefined;
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
  if (defaultCollapsedRef.current === null && loaded && stateLoaded) {
    defaultCollapsedRef.current = collapsible;
  }
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded =
    userExpanded ??
    (defaultCollapsedRef.current === null
      ? true
      : !defaultCollapsedRef.current);

  const visible = collapsible && !expanded ? enabled : sorted;

  // Non-user sources (Seed List / template) are protected from deletion.
  const canRemove = !source.system && !source.fromTemplate;

  return (
    <div
      className={cn(
        "rounded-lg border border-border",
        readOnly ? "bg-muted" : "bg-card",
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-foreground">
              {source.name}
            </p>
            {loaded && !error && (
              <span className="shrink-0 text-[13px] text-muted-foreground">
                {enabled.length} of {list.length} on
              </span>
            )}
          </div>
          <p className="truncate text-[13px] text-muted-foreground">
            {repoLabel(source)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {loading && (
            <Loader2 size={15} className="animate-spin text-muted-foreground" />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="Source actions"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MoreHorizontal size={18} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={onRescan}>Re-scan</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  window.open(source.gitUrl, "_blank", "noopener,noreferrer")
                }
              >
                <span className="flex-1">View repo</span>
                <ExternalLink size={14} />
              </DropdownMenuItem>
              {canRemove && (
                <DropdownMenuItem tone="danger" onSelect={onRemove}>
                  Remove source
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!loaded && !error && <SkillRowsSkeleton />}
      {error && <SourceError error={error} />}
      {loaded && !error && list.length === 0 && (
        <p className="border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
          No skills in this source.
        </p>
      )}
      {loaded &&
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

      {loaded && !error && collapsible && (
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
