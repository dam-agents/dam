import { Add, Save } from "@carbon/icons-react";
import type { DragEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentState } from "../../../../types.js";
import { useResolvedHarnessConfig } from "../../../agents/api/harness-config.js";
import { useWakeAgent } from "../../../agents/hooks/use-wake-agent.js";
import { useSkillsConfirms } from "../../hooks/use-skills-confirms.js";
import { useSkillsDerivations } from "../../hooks/use-skills-derivations.js";
import { useSkillsSurface } from "../../hooks/use-skills-surface.js";
import { AgentDisabledNotice } from "./agent-disabled-notice.js";
import { LocalSkillsGroup } from "./local-skills-group.js";
import { PlatformSkillsGroup } from "./platform-skills-group.js";
import { SkillDriftBanner } from "./skill-drift-banner.js";
import { AddSourceRow, SkillSourcesSection } from "./skill-sources-section.js";
import { type SkillsModal, SkillsModals } from "./skills-modals.js";
import { SkillsNeverRunPanel } from "./skills-never-run-panel.js";
import { SkillsSearchHeader } from "./skills-search-header.js";
import { SkillSourcesSkeleton } from "./skills-skeleton.js";
import { SkillsStoppedPanel } from "./skills-stopped-panel.js";
import { StandaloneSkillsGroup } from "./standalone-skills-group.js";

export function SkillsSurface({
  agentId,
  agentState,
  agentDisabled = false,
  readOnly,
  comingUp,
}: {
  agentId: string | null;
  agentState: AgentState | undefined;
  agentDisabled?: boolean;
  readOnly: boolean;
  comingUp?: boolean;
}) {
  const isError = agentState === "error";
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const wakeAgent = useWakeAgent();
  const { hasRun, pending: configPending } = useResolvedHarnessConfig(agentId);
  const [openModal, setOpenModal] = useState<SkillsModal | null>(null);
  const [pageDrag, setPageDrag] = useState(false);
  const [query, setQuery] = useState("");

  const surface = useSkillsSurface(agentId, { readOnly, isError });
  const derived = useSkillsDerivations(surface, { readOnly, query });
  const {
    deleteStandaloneWithConfirm,
    trackWithConfirm,
    toggleAllWithConfirm,
    removeSourceWithConfirm,
  } = useSkillsConfirms(surface, derived);
  const { sources, publishes, updatingAll, updateAll, downloadStandalone } =
    surface;
  const {
    searching,
    totals,
    matchCount,
    shownCreatedHere,
    shownPlatform,
    shownBuiltIn,
    publishableSources,
    previewReady,
    anyInstalled,
    drifted,
    trackTargets,
    snapshotRows,
    snapshotOnCount,
  } = derived;

  const openAddSource = () =>
    setOpenModal({ kind: "add-source", mode: "github", files: [] });
  const addSourceButton = (
    <Button variant="outline" size="sm" onClick={openAddSource}>
      <Add size={16} /> Add source
    </Button>
  );
  const addSourceRow = <AddSourceRow onClick={openAddSource} />;

  const manageConnections = agentId
    ? () => navigateToSandboxHome(agentId, "connections")
    : undefined;

  const ran = hasRun || surface.standaloneSnapshot !== undefined;
  const disabledNotice =
    agentDisabled && agentId ? (
      <AgentDisabledNotice agentId={agentId} />
    ) : undefined;

  const stoppedPanel = (
    <SkillsStoppedPanel
      onCount={snapshotOnCount}
      rows={snapshotRows}
      sources={sources}
      sourcesLoaded={surface.sourcesLoaded}
      visibilityBySource={surface.visibilityBySource}
      scannedAtBySource={surface.scannedAtBySource}
      loadingBySource={surface.loadingBySource}
      revalidatingBySource={surface.revalidatingBySource}
      errorBySource={surface.errorBySource}
      addSourceRow={addSourceRow}
      disabledNotice={disabledNotice}
      comingUp={!!comingUp}
      onStart={() => agentId && wakeAgent.wake(agentId)}
      onRescan={(src) => void surface.refreshSource(src.id)}
      onRemove={(src) => void removeSourceWithConfirm(src)}
      onManageConnections={manageConnections}
    />
  );

  const dropEnabled = !readOnly && !!agentId;
  const surfaceDropProps = dropEnabled
    ? {
        onDragOver: (e: DragEvent<HTMLDivElement>) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          setPageDrag(true);
        },
        onDragLeave: (e: DragEvent<HTMLDivElement>) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setPageDrag(false);
        },
        onDrop: (e: DragEvent<HTMLDivElement>) => {
          e.preventDefault();
          setPageDrag(false);
          const files = [...e.dataTransfer.files];
          if (files.length > 0)
            setOpenModal({ kind: "add-source", mode: "upload", files });
        },
      }
    : {};

  const neverRunPanel = (
    <SkillsNeverRunPanel
      sources={sources}
      sourcesLoaded={surface.sourcesLoaded}
      visibilityBySource={surface.visibilityBySource}
      scannedAtBySource={surface.scannedAtBySource}
      loadingBySource={surface.loadingBySource}
      revalidatingBySource={surface.revalidatingBySource}
      errorBySource={surface.errorBySource}
      addSourceButton={addSourceButton}
      addSourceRow={addSourceRow}
      disabledNotice={disabledNotice}
      comingUp={!!comingUp}
      onStart={() => agentId && wakeAgent.wake(agentId)}
      onRescan={(src) => void surface.refreshSource(src.id)}
      onRemove={(src) => void removeSourceWithConfirm(src)}
      onManageConnections={manageConnections}
    />
  );

  return (
    <div
      {...surfaceDropProps}
      className={cn(
        "flex flex-col",
        pageDrag && "rounded-lg ring-2 ring-primary ring-offset-2",
      )}
    >
      {readOnly ? (
        configPending && !ran ? (
          <SkillSourcesSkeleton />
        ) : ran ? (
          stoppedPanel
        ) : (
          neverRunPanel
        )
      ) : (
        <>
          {}
          <div className="mb-5">
            <SkillsSearchHeader
              query={query}
              onQueryChange={setQuery}
              totals={totals}
              matchCount={matchCount}
              notice={
                drifted.length > 0 ? (
                  <SkillDriftBanner
                    drifted={drifted}
                    busy={updatingAll}
                    onUpdateAll={() => void updateAll(drifted)}
                  />
                ) : undefined
              }
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!anyInstalled || !previewReady}
                  tooltip={
                    !previewReady
                      ? "Still reading your sources…"
                      : anyInstalled
                        ? undefined
                        : "Turn on at least one skill from a source to save a set"
                  }
                  onClick={() => setOpenModal({ kind: "save-set" })}
                >
                  <Save size={16} /> Save as skill set…
                </Button>
              }
            />
          </div>

          <div className="flex flex-col gap-8">
            {(shownCreatedHere.length > 0 || !searching) && (
              <StandaloneSkillsGroup
                skills={shownCreatedHere}
                readOnly={false}
                publishes={publishes}
                canPublish={publishableSources.length > 0}
                onPublish={(skill) => setOpenModal({ kind: "publish", skill })}
                onDownload={(skill) => void downloadStandalone(skill)}
                onDelete={(skill, pub) =>
                  void deleteStandaloneWithConfirm(skill, pub)
                }
                onTrack={(skill, target) =>
                  void trackWithConfirm(skill, target)
                }
                onOpenSkill={
                  agentId
                    ? (skill) => setOpenModal({ kind: "render-local", skill })
                    : undefined
                }
                trackTargets={trackTargets}
                onUpload={
                  dropEnabled
                    ? () =>
                        setOpenModal({
                          kind: "add-source",
                          mode: "upload",
                          files: [],
                        })
                    : undefined
                }
              />
            )}

            <SkillSourcesSection
              readOnly={false}
              surface={surface}
              derived={derived}
              onAddSource={() =>
                setOpenModal({
                  kind: "add-source",
                  mode: "github",
                  files: [],
                })
              }
              onOpenSkill={(source, skill) =>
                setOpenModal({ kind: "render", source, skill })
              }
              onAddSets={() => setOpenModal({ kind: "add-sets" })}
              onToggleAll={(src, on, scope) =>
                void toggleAllWithConfirm(src, on, scope)
              }
              onRemove={(src) => void removeSourceWithConfirm(src)}
              onManageConnections={manageConnections}
            />

            {}
            {shownPlatform.length > 0 && (
              <PlatformSkillsGroup
                skills={shownPlatform}
                onOpenSkill={
                  agentId
                    ? (skill) => setOpenModal({ kind: "render-local", skill })
                    : undefined
                }
                onOpenSection={
                  agentId
                    ? (section) => navigateToSandboxHome(agentId, section)
                    : undefined
                }
              />
            )}

            {shownBuiltIn.length > 0 && (
              <LocalSkillsGroup
                label="Included with sandbox image"
                skills={shownBuiltIn}
                onOpenSkill={
                  agentId
                    ? (skill) => setOpenModal({ kind: "render-local", skill })
                    : undefined
                }
              />
            )}
          </div>
        </>
      )}

      <SkillsModals
        open={openModal}
        agentId={agentId}
        surface={surface}
        derived={derived}
        onPublish={(skill) => setOpenModal({ kind: "publish", skill })}
        onDeleteLocal={(skill, pub) =>
          void deleteStandaloneWithConfirm(skill, pub)
        }
        onClose={() => setOpenModal(null)}
      />
    </div>
  );
}
