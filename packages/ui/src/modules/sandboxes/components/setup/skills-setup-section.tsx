import { Add } from "@carbon/icons-react";
import type { LocalSkill } from "api-server-api";
import { skillKey } from "api-server-api";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../../store.js";
import type { SkillsSetup } from "../../hooks/use-skills-setup.js";
import { AddSkillSetsModal } from "../skills/add-skill-sets-modal.js";
import { AddSkillSourceModal } from "../skills/add-skill-source-modal.js";
import { SkillSourceCard } from "../skills/skill-source-card.js";
import { StandaloneSkillRow } from "../skills/standalone-skill-row.js";

type SetupModal = { kind: "add-source" } | { kind: "add-sets" };

function SkillsSetupEmpty({
  action,
  setsAction,
}: {
  action: ReactNode;
  setsAction: ReactNode | null;
}) {
  return (
    <Callout variant="dashed">
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          Add a GitHub source to browse and turn on skills before your agent
          starts — or apply a saved skill set.
        </p>
        <div className="flex items-center gap-2">
          {action}
          {setsAction}
        </div>
      </div>
    </Callout>
  );
}

export function SkillsSetupSection({ setup }: { setup: SkillsSetup }) {
  const [openModal, setOpenModal] = useState<SetupModal | null>(null);
  const showConfirm = useStore((s) => s.showConfirm);

  const {
    sources,
    sourcesLoaded,
    skillsBySource,
    loadingBySource,
    errorBySource,
    installedRef,
    sets,
    pendingSetIds,
    toggle,
    toggleSource,
    selectedKeys,
    stagedLocalSkills,
    removeLocalSkill,
  } = setup;

  const availableKeys = useMemo(() => {
    const out = new Set<string>();
    for (const list of Object.values(skillsBySource)) {
      for (const skill of list) out.add(skillKey(skill));
    }
    return out;
  }, [skillsBySource]);

  const installedKeys = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const previewReady =
    sourcesLoaded && sources.every((s) => skillsBySource[s.id] !== undefined);

  const addSourceButton = (
    <Button
      variant="outline"
      onClick={() => setOpenModal({ kind: "add-source" })}
    >
      <Add size={16} /> Add source
    </Button>
  );

  const setsButton =
    sets.length > 0 ? (
      <Button
        variant="outline"
        onClick={() => setOpenModal({ kind: "add-sets" })}
      >
        <Add size={16} /> Add skill sets
      </Button>
    ) : null;

  const handleRemoveSource = async (sourceId: string, sourceName: string) => {
    const ok = await showConfirm(
      "This skill source will be removed, you will need to add the github source url again to re-access these skills.",
      `Delete ${sourceName}?`,
      { kind: "destructive", confirmLabel: "Delete connection" },
    );
    if (ok) await setup.removeSource(sourceId);
  };

  const handleApplySets = async (setIds: string[]): Promise<boolean> => {
    setup.setPendingSetIds(setIds);
    return true;
  };

  const hasContent =
    sources.length > 0 || stagedLocalSkills.length > 0;
  const selectedCount =
    selectedKeys.size + pendingSetIds.length + stagedLocalSkills.length;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <SectionLabel>Skills</SectionLabel>
          {selectedCount > 0 && (
            <span className="text-sm text-muted-foreground">
              {selectedCount} skill{selectedCount === 1 ? "" : "s"} selected
              {pendingSetIds.length > 0 &&
                ` · ${pendingSetIds.length} set${pendingSetIds.length === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
        {sourcesLoaded && hasContent && (
          <div className="flex items-center gap-2">
            {addSourceButton}
            {setsButton}
          </div>
        )}
      </div>

      {!sourcesLoaded ? null : !hasContent ? (
        <SkillsSetupEmpty action={addSourceButton} setsAction={setsButton} />
      ) : (
        <div className="flex flex-col gap-3">
          {sources.map((src) => (
            <SkillSourceCard
              key={src.id}
              source={src}
              skills={skillsBySource[src.id]}
              loading={!!loadingBySource[src.id]}
              error={errorBySource[src.id] ?? null}
              installedRef={installedRef}
              busyKey={null}
              disabled={false}
              stateLoaded={true}
              readOnly={false}
              onToggle={toggle}
              onRemove={() => void handleRemoveSource(src.id, src.name)}
              onUpdate={() => {}}
              onOpenSkill={() => {}}
              onToggleAll={(on, scope) =>
                toggleSource(src.id, scope ?? skillsBySource[src.id] ?? [], on)
              }
              bulkBusy={false}
            />
          ))}

          {stagedLocalSkills.length > 0 && (
            <Card>
              {stagedLocalSkills.map((staged, i) => {
                const skill: LocalSkill = {
                  name: staged.name,
                  description: "",
                  skillPath: `skills/${staged.name}`,
                  origin: "user",
                  contentHash: "",
                };
                return (
                  <StandaloneSkillRow
                    key={staged.name}
                    skill={skill}
                    divided={i > 0}
                    readOnly={false}
                    canPublish={false}
                    onPublish={() => {}}
                    onDownload={() => {}}
                    onDelete={() => removeLocalSkill(staged.name)}
                  />
                );
              })}
            </Card>
          )}
        </div>
      )}

      {openModal?.kind === "add-source" && (
        <AddSkillSourceModal
          onClose={() => setOpenModal(null)}
          onCreate={setup.createSource}
          onCreateSkills={setup.createLocalSkills}
          initialTab="github"
        />
      )}

      {openModal?.kind === "add-sets" && (
        <AddSkillSetsModal
          sets={sets}
          loadFailed={false}
          available={availableKeys}
          installedKeys={installedKeys}
          unreadableSources={new Set()}
          ready={previewReady}
          applying={false}
          onApply={handleApplySets}
          onDelete={setup.deleteSet}
          onClose={() => setOpenModal(null)}
        />
      )}
    </section>
  );
}
