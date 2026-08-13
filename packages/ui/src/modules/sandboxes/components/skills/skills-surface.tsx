import { Add, Upload } from "@carbon/icons-react";
import type { SkillsState } from "api-server-api";
import type { DragEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentState } from "../../../../types.js";
import { useSkillsConfirms } from "../../hooks/use-skills-confirms.js";
import { useSkillsDerivations } from "../../hooks/use-skills-derivations.js";
import { useSkillsSurface } from "../../hooks/use-skills-surface.js";
import { BuiltInSkillsGroup } from "./built-in-skills-group.js";
import { SkillDriftBanner } from "./skill-drift-banner.js";
import { SkillSetActions } from "./skill-set-actions.js";
import { SkillSourcesSection } from "./skill-sources-section.js";
import { type SkillsModal, SkillsModals } from "./skills-modals.js";
import { SkillsSearchHeader } from "./skills-search-header.js";
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
    sourcesLoaded,
    stateLoaded,
    standalone,
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
  } = derived;

  const addSourceButton = readOnly ? null : (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        setOpenModal({ kind: "add-source", tab: "github", files: [] })
      }
    >
      <Add size={14} /> Add source
    </Button>
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

  const isEmpty =
    !readOnly &&
    sourcesLoaded &&
    stateLoaded &&
    sources.length === 0 &&
    standalone.length === 0;

  return (
    <div
      {...surfaceDropProps}
      className={cn(
        "flex flex-col gap-8",
        readOnly && "pointer-events-none",
        readOnly && (comingUp ? "opacity-60" : "opacity-40"),
        pageDrag && "rounded-lg ring-2 ring-primary ring-offset-2",
      )}
    >
      {isEmpty ? (
        <section>
          <SectionLabel spaced>Skills</SectionLabel>
          <Callout variant="dashed">
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <Upload size={22} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drop a .md file here to create a skill, or add a GitHub repo as
                a source.
              </p>
              {addSourceButton}
            </div>
          </Callout>
        </section>
      ) : (
        <>
          {}
          {!readOnly && (
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
          )}

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
              action={addSourceButton}
            />
          ) : searching ? null : readOnly ? (
            <StandaloneSkillsPlaceholder />
          ) : (
            <StandaloneSkillsEmptyState action={addSourceButton} />
          )}

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
            onToggleAll={(src, on) => void toggleAllWithConfirm(src, on)}
            onRemove={(src) => void removeSourceWithConfirm(src)}
            onManageConnections={
              agentId
                ? () => navigateToSandboxHome(agentId, "connections")
                : undefined
            }
          />
        </>
      )}

      <SkillsModals
        open={openModal}
        agentId={agentId}
        surface={surface}
        derived={derived}
        onClose={() => setOpenModal(null)}
      />
    </div>
  );
}
