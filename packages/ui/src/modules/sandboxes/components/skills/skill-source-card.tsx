import {
  ChevronDown,
  ChevronUp,
  Launch,
  Renew,
  Time,
  TrashCan,
  ViewOff,
} from "@carbon/icons-react";
import type { ScanFailure, Skill, SkillRef, SkillSource } from "api-server-api";
import { skillKey } from "api-server-api";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { Spinner } from "@/components/ui/spinner";
import { formatTimestamp, timeAgo } from "@/lib/format-time";
import { gitCompareUrl, repoSlug } from "@/lib/git-source";
import { cn } from "@/lib/utils";

import type { SkillIdentity } from "../../lib/skill-identity.js";
import { selectionKey } from "../../lib/skill-identity.js";
import { isDrifted } from "./skill-drift.js";
import { SkillRow } from "./skill-row.js";
import { SourceError } from "./skill-source-error.js";
import { SkillRowsSkeleton } from "./skills-skeleton.js";

function repoLabel(source: SkillSource): string {
  const base = repoSlug(source.gitUrl);
  return source.path ? `${base} · ${source.path}` : base;
}

function ScanFreshness({
  scannedAt,
  rescanning,
  onRescan,
}: {
  scannedAt: string;
  rescanning: boolean;
  onRescan: () => void;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
      {rescanning ? (
        <Spinner size={14} label="Re-scanning this source" />
      ) : (
        <Time size={13} />
      )}
      <span title={formatTimestamp(scannedAt)}>
        scanned {timeAgo(scannedAt)}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Re-scan this source"
        tooltip="Re-scan this source"
        disabled={rescanning}
        onClick={onRescan}
        className="text-muted-foreground"
      >
        <Renew size={14} />
      </Button>
    </span>
  );
}

export function SkillSourceCard({
  source,
  skills,
  loading,
  revalidating,
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
  onHide,
  hasInstalled,
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
  revalidating: boolean;
  error: ScanFailure | null;
  scannedAt?: string;
  visibility?: "public" | "private";
  installedRef: (skill: SkillIdentity) => SkillRef | undefined;
  busyKey: string | null;
  disabled: boolean;
  stateLoaded: boolean;
  readOnly: boolean;
  onToggle: (skill: Skill) => void;
  onRescan: () => void;
  onRemove: () => void;
  onHide?: () => void;
  hasInstalled: boolean;
  onUpdate: (skill: Skill) => void;
  onOpenSkill: (skill: Skill) => void;
  suppressedNames?: ReadonlySet<string>;
  onManageConnections?: () => void;
  filteredNames?: ReadonlySet<string> | null;
  onToggleAll?: (on: boolean, scope?: Skill[]) => void;
  bulkBusy?: boolean;
}) {
  const loaded = skills !== undefined;
  const list = (skills ?? []).filter((s) => !suppressedNames?.has(s.name));
  const enabled = list.filter((s) => installedRef(s) !== undefined);
  const available = list.filter((s) => installedRef(s) === undefined);
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

  const bulkList = filtering ? visible : list;
  const bulkAllOn =
    bulkList.length > 0 && bulkList.every((s) => installedRef(s) !== undefined);

  const canRemove = !source.system && !source.fromTemplate;
  const hideBlocker = !stateLoaded
    ? "Still reading this agent's skills…"
    : hasInstalled
      ? "Turn its skills off first"
      : null;

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-md font-medium text-foreground">
              {source.name}
            </p>
            {loaded && (
              <span className="shrink-0 text-sm text-muted-foreground">
                {enabled.length} of {list.length} on
              </span>
            )}
            {}
            {visibility === "private" && (
              <Badge
                variant="muted"
                className="shrink-0"
                title="Only readable through this agent's GitHub connection"
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
          {}
          {scannedAt && (
            <ScanFreshness
              scannedAt={scannedAt}
              rescanning={revalidating}
              onRescan={onRescan}
            />
          )}
          {!scannedAt && loading && (
            <Spinner size={14} label="Scanning this source" />
          )}
          {}
          {onToggleAll && !readOnly && loaded && (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || bulkBusy || bulkList.length === 0}
              onClick={() =>
                onToggleAll(!bulkAllOn, filtering ? visible : undefined)
              }
            >
              {bulkBusy && <Spinner size={14} />}
              {filtering
                ? `${bulkAllOn ? "Disable" : "Enable"} ${bulkList.length} matching`
                : bulkAllOn
                  ? "Disable all"
                  : "Enable all"}
            </Button>
          )}
          {}
          <RowActionsMenu label="Source actions">
            <DropdownMenuItem
              disabled={loading || revalidating}
              onSelect={onRescan}
            >
              Re-scan
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                window.open(source.gitUrl, "_blank", "noopener,noreferrer")
              }
            >
              <span className="flex-1">View on GitHub</span>
              <Launch size={14} />
            </DropdownMenuItem>
            {onHide && !readOnly && (
              <DropdownMenuItem
                disabled={disabled || hideBlocker !== null}
                onSelect={onHide}
                className={cn(hideBlocker && "h-auto items-start py-2")}
              >
                <ViewOff
                  size={14}
                  className={cn("shrink-0", hideBlocker && "mt-0.5")}
                />
                <span className="flex-1">
                  Hide for this agent
                  {hideBlocker && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {hideBlocker}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
            )}
            {canRemove && (
              <DropdownMenuItem tone="danger" onSelect={onRemove}>
                <TrashCan size={14} />
                <span className="flex-1">Remove source</span>
              </DropdownMenuItem>
            )}
          </RowActionsMenu>
        </div>
      </div>

      {!loaded && !error && <SkillRowsSkeleton />}
      {error && (
        <SourceError
          failure={error}
          onManageConnections={onManageConnections}
        />
      )}
      {loaded && list.length === 0 && (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
          No skills in this source.
        </p>
      )}
      {loaded &&
        visible.map((skill) => {
          const ref = installedRef(skill);
          const hasDrift = isDrifted(ref, skill);
          return (
            <SkillRow
              key={skillKey(skill)}
              skill={skill}
              installed={ref !== undefined}
              busy={busyKey === selectionKey(skill)}
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

      {loaded && collapsible && !filtering && (
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
    </div>
  );
}
