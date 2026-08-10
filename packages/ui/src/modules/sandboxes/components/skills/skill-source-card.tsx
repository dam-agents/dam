import {
  ChevronDown,
  ChevronUp,
  Launch,
  OverflowMenuHorizontal,
  Warning,
} from "@carbon/icons-react";
import type { ScanFailure, Skill, SkillRef, SkillSource } from "api-server-api";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { formatTimestamp, timeAgo } from "@/lib/format-time";
import { gitCompareUrl, repoSlug } from "@/lib/git-source";
import { isConnectionFailure } from "@/lib/scan-failure";
import { cn } from "@/lib/utils";

import { skillKey } from "../../hooks/use-skills-surface.js";
import { isDrifted } from "./skill-drift.js";
import { SkillRow } from "./skill-row.js";
import { SkillRowsSkeleton } from "./skills-skeleton.js";

/** Strip the scheme and trailing `.git` so a repo reads as `host/org/repo`. */
function repoLabel(source: SkillSource): string {
  const base = repoSlug(source.gitUrl);
  return source.path ? `${base} · ${source.path}` : base;
}

/** Why a source's scan failed: the cause on one line, the fix beneath it. Both
 *  come from the server's verdict, which is closed-set — the card never renders
 *  a raw error message, so a parser or transport string can't reach the user.
 *  "Manage connections" appears only where connections are the fix.
 *
 *  Only the heading, the icon and the link carry the danger colour; the fix
 *  beneath reads as body text. Colouring the whole band red makes it shout
 *  where it should explain, and leaves nothing to draw the eye to the cause. */
function SourceError({
  failure,
  onManageConnections,
}: {
  failure: ScanFailure;
  onManageConnections?: () => void;
}) {
  const canManage = onManageConnections && isConnectionFailure(failure);
  return (
    <div className="flex items-start gap-2 border-t border-border bg-danger-light px-4 py-3 text-sm text-danger">
      <Warning size={16} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{failure.title}</p>
        <p className="text-muted-foreground">{failure.detail}</p>
      </div>
      {canManage && (
        <Button
          variant="link"
          size="inline"
          onClick={onManageConnections}
          className="shrink-0 font-semibold text-current underline hover:opacity-80"
        >
          Manage connections
        </Button>
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
  scannedAt,
  installedRef,
  busyKey,
  disabled,
  stateLoaded,
  readOnly,
  onToggle,
  onRescan,
  onRemove,
  onUpdate,
  onOpenSkill,
  onManageConnections,
  suppressedNames,
  filteredNames,
  onToggleAll,
  bulkBusy,
}: {
  source: SkillSource;
  /** `undefined` until this source's scan resolves — distinct from an empty
   *  array (loaded, genuinely no skills), so we skeleton instead of flashing
   *  "No skills". */
  skills: Skill[] | undefined;
  loading: boolean;
  /** The server's verdict on the last failed scan, already classified — the
   *  card renders it verbatim rather than interpreting an error. */
  error: ScanFailure | null;
  /** ISO 8601 time this source's list was last read from upstream; absent
   *  until its first successful scan. Rendered as "scanned X ago", and hidden
   *  while errored so we never date a list the user can see failed. */
  scannedAt?: string;
  installedRef: (source: string, name: string) => SkillRef | undefined;
  busyKey: string | null;
  disabled: boolean;
  /** Whether the installed set has loaded — gates the collapse-default snapshot. */
  stateLoaded: boolean;
  /** Read-only (agent stopped/starting): render the card on a muted background
   *  — the dimming + non-interactivity come from the parent surface. */
  readOnly: boolean;
  onToggle: (skill: Skill) => void;
  onRescan: () => void;
  onRemove: () => void;
  /** Re-install a drifted skill at the latest version (06). */
  onUpdate: (skill: Skill) => void;
  /** Open a skill's SKILL.md render modal (05). */
  onOpenSkill: (skill: Skill) => void;
  /** Scanned skills to leave out of this card entirely — rows *and* the count:
   *  this source's own copy of a skill published from this sandbox that is still
   *  byte-identical on disk, so the standalone row above already shows it and a
   *  second row would claim it is "not installed" (#3019). */
  suppressedNames?: ReadonlySet<string>;
  /** Navigate to the sandbox's Connections tab — shown as a "Manage
   *  connections" affordance on a scan error with no server CTA. */
  onManageConnections?: () => void;
  /** Names to show, when a search filter is active — null when it isn't. Rows
   *  outside the set are dropped and the collapse control goes away, so a match
   *  can't hide behind "Expand all"; the user's own collapse choice is left
   *  untouched and returns when the query clears. The header's `N of M on`
   *  deliberately keeps counting the whole source: it states a fact about the
   *  source, not about the filter. */
  filteredNames?: ReadonlySet<string> | null;
  /** Turn every skill in this source on or off in one action. `on` is what the
   *  control will do, so the caller never has to re-derive it. */
  onToggleAll?: (on: boolean) => void;
  /** A bulk action is in flight for this source — the whole card is working,
   *  which the per-row `busyKey` cannot express. */
  bulkBusy?: boolean;
}) {
  const loaded = skills !== undefined;
  // Suppressed entries drop out before anything else derives from the list, so
  // the `N of M on` count and the collapse decision agree with the rows on
  // screen. Counting a row the page deliberately hides reads as a bug — "0 of 3
  // on" above two rows sends the reader looking for a third.
  const list = (skills ?? []).filter((s) => !suppressedNames?.has(s.name));
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

  const allEnabled = list.length > 0 && enabled.length === list.length;
  const filtering = filteredNames != null;
  const visible = filtering
    ? sorted.filter((s) => filteredNames.has(s.name))
    : collapsible && !expanded
      ? enabled
      : sorted;

  // Non-user sources (Seed List / template) are protected from deletion.
  const canRemove = !source.system && !source.fromTemplate;

  return (
    <Card className={cn(readOnly && "bg-muted")}>
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-foreground">
              {source.name}
            </p>
            {loaded && !error && (
              <span className="shrink-0 text-sm text-muted-foreground">
                {enabled.length} of {list.length} on
              </span>
            )}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {repoLabel(source)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Names what it will do, never the current state. Hidden while a
              search filter is active: a control that says "all" beside four
              visible rows out of twenty-two is a trap, and narrowing it to the
              matches would be a different, unasked-for action. */}
          {onToggleAll && !readOnly && !filtering && loaded && !error && (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || bulkBusy || list.length === 0}
              onClick={() => onToggleAll(!allEnabled)}
            >
              {bulkBusy && <Spinner size={13} />}
              {allEnabled ? "Disable all" : "Enable all"}
            </Button>
          )}
          {/* This label re-renders only because the surface's 5s installed-state
              poll hands back a fresh array identity. Memoizing this card, or
              moving that poll to react-query with structural sharing, freezes
              it at whatever it said on mount — give it its own tick first. */}
          {!error && scannedAt && (
            <span
              className="shrink-0 text-sm text-muted-foreground"
              title={formatTimestamp(scannedAt)}
            >
              scanned {timeAgo(scannedAt)}
            </span>
          )}
          {loading && <Spinner size={15} />}
          {/* Source administration (re-scan / view repo / remove) is
              account-scoped and pod-independent, so it stays available even
              while the agent is stopped. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Source actions"
                className="shrink-0 text-muted-foreground"
              >
                <OverflowMenuHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={onRescan}>Re-scan</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  window.open(source.gitUrl, "_blank", "noopener,noreferrer")
                }
              >
                <span className="flex-1">View repo</span>
                <Launch size={14} />
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
      {error && (
        <SourceError
          failure={error}
          onManageConnections={onManageConnections}
        />
      )}
      {loaded && !error && list.length === 0 && (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
          No skills in this source.
        </p>
      )}
      {loaded &&
        !error &&
        visible.map((skill) => {
          const ref = installedRef(skill.source, skill.name);
          const hasDrift = isDrifted(ref, skill);
          return (
            <SkillRow
              key={skillKey(skill.source, skill.name)}
              skill={skill}
              installed={ref !== undefined}
              busy={busyKey === skillKey(skill.source, skill.name)}
              disabled={disabled}
              hasDrift={hasDrift}
              compareUrl={
                hasDrift && ref
                  ? gitCompareUrl(source.gitUrl, ref.version, skill.version)
                  : null
              }
              onToggle={() => onToggle(skill)}
              onUpdate={() => onUpdate(skill)}
              // Previewing SKILL.md reads from the api-server (public sources),
              // so it works without a running pod — keep the name clickable.
              onOpen={() => onOpenSkill(skill)}
            />
          );
        })}

      {loaded && !error && collapsible && !filtering && (
        <button
          type="button"
          onClick={() => setUserExpanded(!expanded)}
          className="flex w-full items-center gap-1 border-t border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? "Hide available" : "Expand all"}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
    </Card>
  );
}
