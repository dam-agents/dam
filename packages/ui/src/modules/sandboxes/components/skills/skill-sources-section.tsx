import { Add, Time } from "@carbon/icons-react";
import type { Skill, SkillSource } from "api-server-api";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

import type { SkillsDerivations } from "../../hooks/use-skills-derivations.js";
import type { SkillsSurface } from "../../hooks/use-skills-surface.js";
import { SkillSourceCard } from "./skill-source-card.js";
import { SkillSourcesSkeleton } from "./skills-skeleton.js";

/** The "Sourced from GitHub" region: one card per connected source, with its own
 *  loading, empty and list states. */
export function SkillSourcesSection({
  agentId,
  readOnly,
  isError,
  surface,
  derived,
  action,
  onOpenSkill,
  onAddSets,
  onToggleAll,
  onRemove,
  onManageConnections,
}: {
  agentId: string | null;
  readOnly: boolean;
  isError: boolean;
  surface: SkillsSurface;
  derived: SkillsDerivations;
  /** The "Add source" control, or null while read-only. */
  action: ReactNode;
  onOpenSkill: (source: SkillSource, skill: Skill) => void;
  onAddSets: () => void;
  onToggleAll: (source: SkillSource, on: boolean, scope?: Skill[]) => void;
  onRemove: (source: SkillSource) => void;
  onManageConnections: (() => void) | undefined;
}) {
  const {
    sources,
    sourcesLoaded,
    skillsBySource,
    loadingBySource,
    errorBySource,
    scannedAtBySource,
    visibilityBySource,
    stateLoaded,
    installedRef,
    busyKey,
    busySourceId,
    sets,
  } = surface;
  const { searching, shownSources, filteredBySource, suppressedBySource } =
    derived;

  // Every source filtered out is the search's answer, not an empty page.
  if (searching && shownSources.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionLabel>Sourced from GitHub</SectionLabel>
        {action}
      </div>
      {!sourcesLoaded ? (
        <SkillSourcesSkeleton />
      ) : sources.length === 0 ? (
        <Callout variant="dashed">
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <Time size={20} className="text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              No skill sources connected. Add a GitHub repo to browse and
              install its skills
              {sets.length > 0 && " — or start from a set you've already built"}
              .
            </p>
            {/* Sets apply to source-backed skills, which is exactly what this
                state is missing — so the offer belongs here even though no
                source is connected yet. */}
            <div className="flex items-center gap-2">
              {action}
              {!readOnly && sets.length > 0 && (
                <Button variant="outline" size="sm" onClick={onAddSets}>
                  <Add size={14} /> Add skill sets…
                </Button>
              )}
            </div>
          </div>
        </Callout>
      ) : (
        <div className="flex flex-col gap-3">
          {shownSources.map((src) => (
            <SkillSourceCard
              key={src.id}
              source={src}
              skills={skillsBySource[src.id]}
              filteredNames={filteredBySource?.get(src.id) ?? null}
              loading={!!loadingBySource[src.id]}
              error={errorBySource[src.id] ?? null}
              scannedAt={scannedAtBySource[src.id]}
              visibility={visibilityBySource[src.id]}
              installedRef={installedRef}
              busyKey={busyKey}
              disabled={!agentId || isError}
              stateLoaded={stateLoaded}
              readOnly={readOnly}
              onToggle={surface.toggle}
              onUpdate={surface.update}
              onRescan={() => void surface.refreshSource(src.id)}
              onRemove={() => onRemove(src)}
              onOpenSkill={(skill) => onOpenSkill(src, skill)}
              suppressedNames={suppressedBySource.get(src.id)}
              onToggleAll={(on, scope) => onToggleAll(src, on, scope)}
              bulkBusy={busySourceId === src.id}
              onManageConnections={onManageConnections}
            />
          ))}
        </div>
      )}
    </section>
  );
}
