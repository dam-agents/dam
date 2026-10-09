import { Add, Close } from "@carbon/icons-react";
import type { Skill, SkillRef, SkillSource } from "api-server-api";
import { skillKey } from "api-server-api";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import {
  type SkillsModal,
  SkillsModals,
} from "../../sandboxes/components/skills/skills-modals.js";
import { useSkillsConfirms } from "../../sandboxes/hooks/use-skills-confirms.js";
import { useSkillsDerivations } from "../../sandboxes/hooks/use-skills-derivations.js";
import { useSkillsSurface } from "../../sandboxes/hooks/use-skills-surface.js";

interface Props {
  agentId: string | null;
  agentOperable: boolean;
  onManage: () => void;
}

export function SkillsIndicator({ agentId, agentOperable, onManage }: Props) {
  const titleId = useId();
  const [openModal, setOpenModal] = useState<SkillsModal | null>(null);

  const surface = useSkillsSurface(agentId, {
    readOnly: !agentOperable,
    isError: false,
  });
  const derived = useSkillsDerivations(surface, {
    readOnly: !agentOperable,
    query: "",
  });
  const { toggleAllWithConfirm } = useSkillsConfirms(surface, derived);

  const {
    sources,
    sourcesLoaded,
    stateLoaded,
    skillsBySource,
    installedRef,
    mutationsDisabled,
    busyKey,
  } = surface;

  const { shownSources, totals } = derived;

  if (!sourcesLoaded || !stateLoaded) return null;

  const hasSkills = sources.length > 0;

  return (
    <>
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
          className="flex w-[380px] flex-col gap-0 p-0 text-sm"
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
            {!hasSkills ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No skill sources configured.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setOpenModal({
                        kind: "add-source",
                        tab: "github",
                        files: [],
                      })
                    }
                  >
                    <Add size={16} /> Add source
                  </Button>
                  {surface.sets.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setOpenModal({ kind: "add-sets" })}
                    >
                      <Add size={16} /> Add skill sets
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {shownSources.map((src) => (
                  <CompactSourceCard
                    key={src.id}
                    source={src}
                    skills={skillsBySource[src.id] ?? []}
                    installedRef={installedRef}
                    busyKey={busyKey}
                    disabled={mutationsDisabled}
                    onToggle={(skill) => void surface.toggle(skill)}
                    onToggleAll={(on) =>
                      void toggleAllWithConfirm(src, on, undefined)
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border px-4 py-3">
            <PopoverClose asChild>
              <Button variant="outline" onClick={onManage}>
                Manage
              </Button>
            </PopoverClose>
          </div>
        </PopoverContent>
      </Popover>

      <SkillsModals
        open={openModal}
        agentId={agentId}
        surface={surface}
        derived={derived}
        onPublish={() => {}}
        onDeleteLocal={() => {}}
        onClose={() => setOpenModal(null)}
      />
    </>
  );
}

function CompactSourceCard({
  source,
  skills,
  installedRef,
  busyKey,
  disabled,
  onToggle,
  onToggleAll,
}: {
  source: SkillSource;
  skills: Skill[];
  installedRef: (source: string, name: string) => SkillRef | undefined;
  busyKey: string | null;
  disabled: boolean;
  onToggle: (skill: Skill) => void;
  onToggleAll: (on: boolean) => void;
}) {
  const allOn =
    skills.length > 0 &&
    skills.every((s) => installedRef(s.source, s.name) !== undefined);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <SectionLabel>{source.name}</SectionLabel>
        {skills.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onToggleAll(!allOn)}
            className="shrink-0 text-xs text-muted-foreground"
          >
            {allOn ? "Disable all" : "Enable all"}
          </Button>
        )}
      </div>
      {skills.length === 0 ? (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
          No skills in this source.
        </p>
      ) : (
        skills.map((skill) => {
          const installed =
            installedRef(skill.source, skill.name) !== undefined;
          const busy = busyKey === skillKey(skill);
          return (
            <div
              key={skillKey(skill)}
              className={cn(
                "flex items-center gap-3 border-t border-border px-4 py-2",
                installed && "bg-muted/40",
              )}
            >
              <p className="min-w-0 flex-1 truncate text-sm text-foreground">
                {skill.name}
              </p>
              <Switch
                checked={installed}
                onCheckedChange={() => onToggle(skill)}
                label={`${installed ? "Disable" : "Enable"} ${skill.name}`}
                className={cn(
                  (disabled || busy) && "pointer-events-none opacity-50",
                )}
              />
            </div>
          );
        })
      )}
    </Card>
  );
}
