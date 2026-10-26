import { ChevronDown, ChevronUp, Renew, Time } from "@carbon/icons-react";
import type { Skill, SkillSource } from "api-server-api";
import { skillKey } from "api-server-api";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatTimestamp, timeAgo } from "@/lib/format-time";
import { gitCompareUrl } from "@/lib/git-source";

import type { SkillsDerivations } from "../../hooks/use-skills-derivations.js";
import type { SkillsSurface } from "../../hooks/use-skills-surface.js";
import { sameSourcePath, selectionKey } from "../../lib/skill-identity.js";
import { isDrifted } from "./skill-drift.js";
import { SkillRow } from "./skill-row.js";
import { SourceError } from "./skill-source-error.js";
import {
  SkillSourceActions,
  SkillSourceHeader,
} from "./skill-source-header.js";
import { SkillRowsSkeleton } from "./skills-skeleton.js";

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
  surface,
  derived,
  onRemove,
  onHide,
  onOpenSkill,
  onToggleAll,
  onManageConnections,
}: {
  source: SkillSource;
  surface: SkillsSurface;
  derived: SkillsDerivations;
  onRemove?: () => void;
  onHide: () => void;
  onOpenSkill: (skill: Skill) => void;
  onToggleAll: (on: boolean, scope?: Skill[]) => void;
  onManageConnections?: () => void;
}) {
  const {
    skillsBySource,
    loadingBySource,
    revalidatingBySource,
    errorBySource,
    scannedAtBySource,
    visibilityBySource,
    installed,
    installedRef,
    mutationsDisabled,
    busyKey,
    busySourceId,
    stateLoaded,
  } = surface;
  const skills = skillsBySource[source.id];
  const loading = !!loadingBySource[source.id];
  const revalidating = !!revalidatingBySource[source.id];
  const error = errorBySource[source.id] ?? null;
  const scannedAt = scannedAtBySource[source.id];
  const visibility = visibilityBySource[source.id];
  const suppressedNames = derived.suppressedBySource.get(source.id);
  const filteredNames = derived.filteredBySource?.get(source.id) ?? null;
  const hasInstalled = installed.some(
    (r) => r.source === source.gitUrl && sameSourcePath(r.path, source.path),
  );
  const bulkBusy = busySourceId === source.id;

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

  const hideBlocker = !stateLoaded
    ? "Still reading this agent's skills…"
    : hasInstalled
      ? "Turn its skills off first"
      : null;

  return (
    <div>
      <SkillSourceHeader
        source={source}
        visibility={visibility}
        badgeTitle="Only readable through this agent's GitHub connection"
        note={
          loaded && (
            <span className="shrink-0 text-sm text-muted-foreground">
              {enabled.length} of {list.length} on
            </span>
          )
        }
      >
        <div className="flex shrink-0 items-center gap-2">
          {scannedAt && (
            <ScanFreshness
              scannedAt={scannedAt}
              rescanning={revalidating}
              onRescan={() => void surface.refreshSource(source.id)}
            />
          )}
          {!scannedAt && loading && (
            <Spinner size={14} label="Scanning this source" />
          )}
          {loaded && (
            <Button
              variant="outline"
              size="sm"
              disabled={mutationsDisabled || bulkBusy || bulkList.length === 0}
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
          <SkillSourceActions
            source={source}
            scannedAt={scannedAt}
            busy={loading || revalidating}
            onRescan={() => void surface.refreshSource(source.id)}
            onRemove={onRemove}
            onHide={onHide}
            hideBlocker={hideBlocker}
            hideDisabled={mutationsDisabled}
          />
        </div>
      </SkillSourceHeader>

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
              disabled={mutationsDisabled}
              hasDrift={hasDrift}
              compareUrl={
                hasDrift && ref
                  ? gitCompareUrl(source.gitUrl, ref.version, skill.version)
                  : null
              }
              onToggle={() => void surface.toggle(skill)}
              onUpdate={() => void surface.update(skill)}
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
