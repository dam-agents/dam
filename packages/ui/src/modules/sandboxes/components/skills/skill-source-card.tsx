import {
  ChevronDown,
  ChevronUp,
  Launch,
  OverflowMenuHorizontal,
  Renew,
  Time,
  TrashCan,
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
import { cn } from "@/lib/utils";

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
  onToggleAll?: (on: boolean, scope?: Skill[]) => void;
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

  const bulkList = filtering ? visible : list;
  const bulkAllOn =
    bulkList.length > 0 &&
    bulkList.every((s) => installedRef(s.source, s.name) !== undefined);

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
            {}
            {visibility === "private" && (
              <Badge
                variant="template"
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
          {!error && scannedAt && (
            <ScanFreshness
              scannedAt={scannedAt}
              scanning={loading}
              onRescan={onRescan}
            />
          )}
          {!scannedAt && loading && <Spinner size={15} />}
          {}
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
          {}
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
