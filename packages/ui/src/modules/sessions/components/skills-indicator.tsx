import { Close } from "@carbon/icons-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { SkillSourceCard } from "../../sandboxes/components/skills/skill-source-card.js";
import { useSkillsDerivations } from "../../sandboxes/hooks/use-skills-derivations.js";
import { useSkillsSurface } from "../../sandboxes/hooks/use-skills-surface.js";

interface Props {
  agentId: string | null;
  agentOperable: boolean;
  onConfigure: () => void;
}

export function SkillsIndicator({
  agentId,
  agentOperable,
  onConfigure,
}: Props) {
  const titleId = useId();

  const surface = useSkillsSurface(agentId, {
    readOnly: true,
    isError: false,
  });
  const derived = useSkillsDerivations(surface, { readOnly: true, query: "" });

  const {
    sources,
    sourcesLoaded,
    stateLoaded,
    skillsBySource,
    loadingBySource,
    errorBySource,
    visibilityBySource,
    installedRef,
  } = surface;

  const { shownSources, totals } = derived;

  if (!sourcesLoaded || !stateLoaded) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {totals.on === 0
            ? "No skills"
            : `${totals.on} skill${totals.on === 1 ? "" : "s"}`}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-labelledby={titleId}
        className="flex w-[480px] flex-col gap-0 p-0 text-sm"
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <h2
            id={titleId}
            className="text-[15px] font-semibold text-foreground"
          >
            Skills
          </h2>
          <PopoverClose asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Close"
              className="-mr-1 -mt-1 shrink-0 text-muted-foreground"
            >
              <Close size={16} />
            </Button>
          </PopoverClose>
        </div>

        <div className="max-h-[460px] overflow-y-auto px-3 pb-3">
          {sources.length === 0 ? (
            <p className="px-1 py-4 text-sm text-muted-foreground">
              No skill sources configured.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {shownSources.map((src) => (
                <SkillSourceCard
                  key={src.id}
                  source={src}
                  skills={skillsBySource[src.id]}
                  filteredNames={null}
                  loading={!!loadingBySource[src.id]}
                  error={errorBySource[src.id] ?? null}
                  visibility={visibilityBySource[src.id]}
                  installedRef={installedRef}
                  busyKey={null}
                  disabled={true}
                  stateLoaded={stateLoaded}
                  readOnly={true}
                  onToggle={() => {}}
                  onUpdate={() => {}}
                  onOpenSkill={() => {}}
                  onToggleAll={() => {}}
                  bulkBusy={false}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border px-4 py-3">
          <PopoverClose asChild>
            <Button variant="outline" onClick={onConfigure}>
              Manage
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}
