import { Add } from "@carbon/icons-react";
import type { Skill, SkillSource } from "api-server-api";

import { Button } from "@/components/ui/button";
import { AddRow, ListSection } from "@/components/ui/list-section";

import type { SkillsDerivations } from "../../hooks/use-skills-derivations.js";
import type { SkillsSurface } from "../../hooks/use-skills-surface.js";
import { SkillSourceCard } from "./skill-source-card.js";
import { SkillRowsSkeleton } from "./skills-skeleton.js";

export function SkillSourcesSection({
  readOnly,
  surface,
  derived,
  onAddSource,
  onOpenSkill,
  onAddSets,
  onToggleAll,
  onRemove,
  onManageConnections,
}: {
  readOnly: boolean;
  surface: SkillsSurface;
  derived: SkillsDerivations;
  onAddSource?: () => void;
  onOpenSkill: (source: SkillSource, skill: Skill) => void;
  onAddSets: () => void;
  onToggleAll: (source: SkillSource, on: boolean, scope?: Skill[]) => void;
  onRemove: (source: SkillSource) => void;
  onManageConnections: (() => void) | undefined;
}) {
  const { sources, sourcesLoaded, hiddenSources, sets } = surface;
  const { searching, shownSources } = derived;

  if (searching && shownSources.length === 0) return null;

  return (
    <ListSection
      label="Sourced from GitHub"
      className="mb-0"
      onNew={onAddSource}
      newLabel="Add source"
      headerExtra={
        !readOnly &&
        sets.length > 0 && (
          <Button variant="outline" size="sm" onClick={onAddSets}>
            <Add size={16} /> Add skill sets…
          </Button>
        )
      }
      addRow={onAddSource && <AddSourceRow onClick={onAddSource} />}
      isEmpty={sourcesLoaded && sources.length === 0}
      empty={
        hiddenSources.length > 0
          ? "Every skill source is hidden for this agent. Add source lists them to show again."
          : "No skill sources connected. Add a GitHub repo to browse and install its skills."
      }
    >
      {!sourcesLoaded ? (
        <SkillRowsSkeleton rows={2} />
      ) : (
        shownSources.map((src) => (
          <SkillSourceCard
            key={src.id}
            source={src}
            surface={surface}
            derived={derived}
            onRemove={() => onRemove(src)}
            onHide={() => void surface.setSourceHidden(src.id, true)}
            onOpenSkill={(skill) => onOpenSkill(src, skill)}
            onToggleAll={(on, scope) => onToggleAll(src, on, scope)}
            onManageConnections={onManageConnections}
          />
        ))
      )}
    </ListSection>
  );
}

export function AddSourceRow({ onClick }: { onClick: () => void }) {
  return (
    <AddRow onClick={onClick}>
      <Add size={16} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-md font-medium text-foreground">Add source</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Browse a repository's skills and install the ones you want.
        </p>
      </div>
    </AddRow>
  );
}
