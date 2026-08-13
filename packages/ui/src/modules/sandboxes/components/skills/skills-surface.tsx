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
  // `hasRun` is the one honest signal that no snapshot is even possible —
  // distinct from a snapshot that happens to be empty. It reads false while
  // the snapshot query is in flight, hence the `pending` guard below.
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

  // Always offered, in every state: a source is an account-scoped row, so
  // connecting one needs no pod. It is the one thing you can still do to a
  // stopped or never-started sandbox's skills.
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

  // The stopped surface is a different page, not a dimmed copy of this one: a
  // dated snapshot plus the live source list. Gated on the snapshot existing,
  // so a sandbox that never ran falls through to its own panel instead of
  // claiming an empty recording is what it had.
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

  // Dropping .md files anywhere on the surface opens the upload tab preloaded.
  // Only while the agent can actually take the write (running + targetable).
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

  // Running with nothing in it is no longer a special page: each group shows
  // its own empty panel, so the image group still renders when the image ships
  // skills. Only the two non-running states replace the surface wholesale.
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
        // No dimming while stopped any more: the panel below says what it is
        // in words and leaves the dead controls out, which a 40%-opacity copy
        // of the live surface never managed to.
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
            // Sits closer to the first group than the groups sit to each
            // other: it describes them, so a full group gap would read as a
            // fourth section rather than as this page's header.
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
              // Starting: the list is on a pod that isn't answering yet, so
              // show the section with a placeholder instead of dropping it.
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

            {/* Last, per the design: the image group is the least actionable of
              the three — nothing in it can be turned off or removed. */}
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
