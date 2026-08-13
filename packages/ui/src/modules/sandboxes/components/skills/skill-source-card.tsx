import {
  ChevronDown,
  ChevronUp,
  Launch,
  OverflowMenuHorizontal,
  Renew,
  Time,
  TrashCan,
  Warning,
} from "@carbon/icons-react";
import type { ScanFailure, Skill, SkillRef, SkillSource } from "api-server-api";
import { skillKey } from "api-server-api";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
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

import { isDrifted } from "./skill-drift.js";
import { SkillRow } from "./skill-row.js";
import { SkillRowsSkeleton } from "./skills-skeleton.js";

function repoLabel(source: SkillSource): string {
  const base = repoSlug(source.gitUrl);
  return source.path ? `${base} · ${source.path}` : base;
}

/** When the list was last read, and the control to read it again. Both live in
 *  one place because the button's only job is to move the timestamp — while a
 *  scan is in flight the pair collapses to a single "Scanning…" line, so the
 *  card never offers a refresh that is already happening. */
function ScanFreshness({
  scannedAt,
  scanning,
  onRescan,
}: {
  scannedAt: string;
  scanning: boolean;
  onRescan: () => void;
}) {
  if (scanning) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
        <Spinner size={13} /> Scanning…
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
      <Time size={13} />
      <span title={formatTimestamp(scannedAt)}>
        scanned {timeAgo(scannedAt)}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Re-scan this source"
        tooltip="Re-scan this source"
        onClick={onRescan}
        className="text-muted-foreground"
      >
        <Renew size={14} />
      </Button>
    </span>
  );
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
 * A single Skill Source rendered as a card: header (name · `N of M on` ·
 * visibility · repo URL, then freshness, bulk toggle and kebab) over its skill
 * rows. Enabled skills sort to the top and the available ones collapse under a
 * "Show N more available" / "Hide available" control. The kebab administers the
 * source (re-scan / view repo / remove); a re-scan replaces the timestamp with
 * "Scanning…" while the rows stay put.
 */
export function SkillSourceCard({
  source,
  skills,
  loading,
  error,
  scannedAt,
  visibility,
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
  skills: Skill[] | undefined;
  loading: boolean;
  error: ScanFailure | null;
  scannedAt?: string;
  /** Whether the scan proved the repo public or private; absent when nothing
   *  proved it, which must render no badge rather than an assumed one. */
  visibility?: "public" | "private";
  installedRef: (source: string, name: string) => SkillRef | undefined;
  busyKey: string | null;
  disabled: boolean;
  stateLoaded: boolean;
  readOnly: boolean;
  onToggle: (skill: Skill) => void;
  onRescan: () => void;
  onRemove: () => void;
  onUpdate: (skill: Skill) => void;
  onOpenSkill: (skill: Skill) => void;
  suppressedNames?: ReadonlySet<string>;
  onManageConnections?: () => void;
  filteredNames?: ReadonlySet<string> | null;
  /** Turn a set of this source's skills on or off in one action. `on` is what
   *  the control will do, so the caller never has to re-derive it; `scope` is
   *  the rows it acts on, absent when that is the whole source. */
  onToggleAll?: (on: boolean, scope?: Skill[]) => void;
  /** A bulk action is in flight for this source — the whole card is working,
   *  which the per-row `busyKey` cannot express. */
  bulkBusy?: boolean;
}) {
  const loaded = skills !== undefined;
  const list = (skills ?? []).filter((s) => !suppressedNames?.has(s.name));
  const enabled = list.filter(
    (s) => installedRef(s.source, s.name) !== undefined,
  );
  const available = list.filter(
    (s) => installedRef(s.source, s.name) === undefined,
  );
  const sorted = [...enabled, ...available];
  const collapsible = enabled.length > 0 && available.length > 0;

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

  const filtering = filteredNames != null;
  const visible = filtering
    ? sorted.filter((s) => filteredNames.has(s.name))
    : collapsible && !expanded
      ? enabled
      : sorted;

  // What the bulk button acts on: the whole source normally, and exactly the
  // rows a search left on screen while one is active. Its label counts this
  // list, so the promise and the action can't drift apart.
  const bulkList = filtering ? visible : list;
  const bulkAllOn =
    bulkList.length > 0 &&
    bulkList.every((s) => installedRef(s.source, s.name) !== undefined);

  // Non-user sources (Seed List / template) are protected from deletion.
  const canRemove = !source.system && !source.fromTemplate;

  return (
    <Card className={cn(readOnly && "bg-muted")}>
      <div className="flex items-center gap-3 px-4 py-3">
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
            {/* Only ever "Private", never "Public": the badge marks the case
                worth knowing about, and an unproven visibility must stay
                unlabelled rather than default to reassuring. */}
            {visibility === "private" && (
              <Badge
                variant="template"
                className="shrink-0"
                title="Only readable through this sandbox's GitHub connection"
              >
                Private
              </Badge>
            )}
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {repoLabel(source)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* This label re-renders only because the surface's 5s installed-state
              poll hands back a fresh array identity. Memoizing this card, or
              moving that poll to react-query with structural sharing, freezes
              it at whatever it said on mount — give it its own tick first. */}
          {!error && scannedAt && (
            <ScanFreshness
              scannedAt={scannedAt}
              scanning={loading}
              onRescan={onRescan}
            />
          )}
          {!scannedAt && loading && <Spinner size={15} />}
          {/* Names what it will do, never the current state — including how
              many rows it will touch once a search has narrowed the card, so
              "all" can never mean twenty-two rows beside four visible ones. */}
          {onToggleAll && !readOnly && loaded && !error && (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || bulkBusy || bulkList.length === 0}
              onClick={() =>
                onToggleAll(!bulkAllOn, filtering ? visible : undefined)
              }
            >
              {bulkBusy && <Spinner size={13} />}
              {filtering
                ? `${bulkAllOn ? "Disable" : "Enable"} ${bulkList.length} matching`
                : bulkAllOn
                  ? "Disable all"
                  : "Enable all"}
            </Button>
          )}
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
                  <TrashCan size={14} />
                  <span className="flex-1">Remove source</span>
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
              key={skillKey(skill)}
              skill={skill}
              installed={ref !== undefined}
              busy={busyKey === skillKey(skill)}
              disabled={disabled}
              hasDrift={hasDrift}
              compareUrl={
                hasDrift && ref
                  ? gitCompareUrl(source.gitUrl, ref.version, skill.version)
                  : null
              }
              onToggle={() => onToggle(skill)}
              onUpdate={() => onUpdate(skill)}
              onOpen={() => onOpenSkill(skill)}
            />
          );
        })}

      {loaded && !error && collapsible && !filtering && (
        // Counts what it will reveal rather than saying "expand all": the
        // number is the reason to click, and it is the one thing a collapsed
        // card cannot show you.
        <button
          type="button"
          onClick={() => setUserExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 border-t border-border px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded
            ? "Hide available"
            : `Show ${available.length} more available`}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
    </Card>
  );
}
