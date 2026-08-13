import {
  ChevronDown,
  ChevronUp,
  Launch,
  OverflowMenuHorizontal,
  Warning,
} from "@carbon/icons-react";
import type { ScanFailure, Skill, SkillRef, SkillSource } from "api-server-api";
import { skillKey } from "api-server-api";
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

import { isDrifted } from "./skill-drift.js";
import { SkillRow } from "./skill-row.js";
import { SkillRowsSkeleton } from "./skills-skeleton.js";

function repoLabel(source: SkillSource): string {
  const base = repoSlug(source.gitUrl);
  return source.path ? `${base} · ${source.path}` : base;
}

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
  skills: Skill[] | undefined;
  loading: boolean;
  error: ScanFailure | null;
  scannedAt?: string;
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
  onToggleAll?: (on: boolean) => void;
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

  const allEnabled = list.length > 0 && enabled.length === list.length;
  const filtering = filteredNames != null;
  const visible = filtering
    ? sorted.filter((s) => filteredNames.has(s.name))
    : collapsible && !expanded
      ? enabled
      : sorted;

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
          {}
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
          {}
          {!error && scannedAt && (
            <span
              className="shrink-0 text-sm text-muted-foreground"
              title={formatTimestamp(scannedAt)}
            >
              scanned {timeAgo(scannedAt)}
            </span>
          )}
          {loading && <Spinner size={15} />}
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
          className="flex w-full items-center gap-1 border-t border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? "Hide available" : "Expand all"}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
    </Card>
  );
}
