import { Add } from "@carbon/icons-react";
import type { SkillsState } from "api-server-api";
import type { DragEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentState } from "../../../../types.js";
import {
  useResolvedHarnessConfig,
  useStaleModel,
} from "../../../agents/api/harness-config.js";
import { useWakeAgent } from "../../../agents/hooks/use-wake-agent.js";
import { useSkillsConfirms } from "../../hooks/use-skills-confirms.js";
import { useSkillsDerivations } from "../../hooks/use-skills-derivations.js";
import { useSkillsSurface } from "../../hooks/use-skills-surface.js";
import { BuiltInSkillsGroup } from "./built-in-skills-group.js";
import { SkillDriftBanner } from "./skill-drift-banner.js";
import { SkillSetActions } from "./skill-set-actions.js";
import { SkillSourcesSection } from "./skill-sources-section.js";
import { type SkillsModal, SkillsModals } from "./skills-modals.js";
import { SkillsNeverRunPanel } from "./skills-never-run-panel.js";
import { SkillsSearchHeader } from "./skills-search-header.js";
import { SkillsStoppedPanel } from "./skills-stopped-panel.js";
import { StaleModelNotice } from "./stale-model-notice.js";
import {
  StandaloneSkillsEmptyState,
  StandaloneSkillsGroup,
  StandaloneSkillsPlaceholder,
} from "./standalone-skills-group.js";

export function SkillsSurface({
  agentId,
  agentState,
  readOnly,
  comingUp,
  onStateChange,
}: {
  agentId: string | null;
  agentState: AgentState | undefined;
  readOnly: boolean;
  comingUp?: boolean;
  onStateChange?: (state: SkillsState) => void;
}) {
  const isError = agentState === "error";
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const wakeAgent = useWakeAgent();
  const { hasRun, pending: configPending } = useResolvedHarnessConfig(agentId);
  const staleModel = useStaleModel(agentId);
  const [openModal, setOpenModal] = useState<SkillsModal | null>(null);
  const [pageDrag, setPageDrag] = useState(false);
  const [query, setQuery] = useState("");

  const surface = useSkillsSurface(agentId, {
    readOnly,
    isError,
    onStateChange,
  });
  const derived = useSkillsDerivations(surface, { readOnly, query });
  const {
    deleteStandaloneWithConfirm,
    trackWithConfirm,
    toggleAllWithConfirm,
    removeSourceWithConfirm,
  } = useSkillsConfirms(surface, derived);
  const {
    sources,
    standaloneSnapshot,
    publishes,
    updatingAll,
    updateAll,
    downloadStandalone,
  } = surface;
  const {
    searching,
    totals,
    matchCount,
    shownCreatedHere,
    shownBuiltIn,
    publishableSources,
    previewReady,
    anyInstalled,
    drifted,
    trackUnavailableNames,
    snapshotRows,
    snapshotOnCount,
  } = derived;

  const addSourceButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        setOpenModal({ kind: "add-source", tab: "github", files: [] })
      }
    >
      <Add size={16} /> Add source
    </Button>
  );

  const stoppedPanel = readOnly && standaloneSnapshot !== undefined && (
    <SkillsStoppedPanel
      capturedAt={standaloneSnapshot.capturedAt}
      onCount={snapshotOnCount}
      rows={snapshotRows}
      sources={sources}
      visibilityBySource={surface.visibilityBySource}
      scannedAtBySource={surface.scannedAtBySource}
      addSourceButton={addSourceButton}
      callout={
        staleModel.stale && staleModel.model ? (
          <StaleModelNotice
            model={staleModel.model}
            comingUp={!!comingUp}
            onStartAndFix={() => {
              if (!agentId) return;
              wakeAgent.wake(agentId);
              navigateToSandboxHome(agentId, "setup");
            }}
          />
        ) : undefined
      }
      comingUp={!!comingUp}
      onStart={() => agentId && wakeAgent.wake(agentId)}
      onRescan={(src) => void surface.refreshSource(src.id)}
      onRemove={(src) => void removeSourceWithConfirm(src)}
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
            setOpenModal({ kind: "add-source", tab: "upload", files });
        },
      }
    : {};

  const neverRunPanel = readOnly && !configPending && !hasRun && (
    <SkillsNeverRunPanel
      sources={sources}
      visibilityBySource={surface.visibilityBySource}
      scannedAtBySource={surface.scannedAtBySource}
      addSourceButton={addSourceButton}
      comingUp={!!comingUp}
      onStart={() => agentId && wakeAgent.wake(agentId)}
      onRescan={(src) => void surface.refreshSource(src.id)}
      onRemove={(src) => void removeSourceWithConfirm(src)}
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
      {neverRunPanel ? (
        neverRunPanel
      ) : stoppedPanel ? (
        stoppedPanel
      ) : (
        <>
          {}
          {!readOnly && (
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
                  <SkillSetActions
                    canSave={anyInstalled}
                    previewReady={previewReady}
                    onAddSets={() => setOpenModal({ kind: "add-sets" })}
                    onSaveSet={() => setOpenModal({ kind: "save-set" })}
                  />
                }
              />
            </div>
          )}

          <div className="flex flex-col gap-8">
            {shownCreatedHere.length > 0 ? (
              <StandaloneSkillsGroup
                skills={shownCreatedHere}
                readOnly={readOnly}
                publishes={publishes}
                canPublish={publishableSources.length > 0}
                onPublish={(skill) => setOpenModal({ kind: "publish", skill })}
                onDownload={(skill) => void downloadStandalone(skill)}
                onDelete={(skill, pub) =>
                  void deleteStandaloneWithConfirm(skill, pub)
                }
                onTrack={(skill, pub) => void trackWithConfirm(skill, pub)}
                onOpenSkill={
                  agentId
                    ? (skill) => setOpenModal({ kind: "render-local", skill })
                    : undefined
                }
                trackUnavailableNames={trackUnavailableNames}
              />
            ) : searching ? null : readOnly ? (
              <StandaloneSkillsPlaceholder />
            ) : (
              <StandaloneSkillsEmptyState />
            )}

            <SkillSourcesSection
              agentId={agentId}
              readOnly={readOnly}
              isError={isError}
              surface={surface}
              derived={derived}
              action={addSourceButton}
              onOpenSkill={(source, skill) =>
                setOpenModal({ kind: "render", source, skill })
              }
              onAddSets={() => setOpenModal({ kind: "add-sets" })}
              onToggleAll={(src, on, scope) =>
                void toggleAllWithConfirm(src, on, scope)
              }
              onRemove={(src) => void removeSourceWithConfirm(src)}
              onManageConnections={
                agentId
                  ? () => navigateToSandboxHome(agentId, "connections")
                  : undefined
              }
            />

            {}
            {shownBuiltIn.length > 0 && (
              <BuiltInSkillsGroup
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
