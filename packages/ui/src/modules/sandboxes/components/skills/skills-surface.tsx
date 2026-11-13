import { Document, Save } from "@carbon/icons-react";
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
import { HiddenSourcesList } from "./hidden-sources-list.js";
import { LocalSkillsGroup } from "./local-skills-group.js";
import { PlatformSkillsGroup } from "./platform-skills-group.js";
import { SkillDriftBanner } from "./skill-drift-banner.js";
import { SkillSourcesSection } from "./skill-sources-section.js";
import { type SkillsModal, SkillsModals } from "./skills-modals.js";
import { SkillsReadOnlyPanel } from "./skills-read-only-panel.js";
import { SkillsSearchHeader } from "./skills-search-header.js";
import { SkillSourcesSkeleton } from "./skills-skeleton.js";
import { StandaloneSkillsGroup } from "./standalone-skills-group.js";

export function SkillsSurface({
  agentId,
  agentState,
  readOnly,
  comingUp,
  managesLibrary,
  canPublish,
  compact = false,
  hideSwitches = false,
  onOpenModal,
}: {
  agentId: string | null;
  agentState: AgentState | undefined;
  readOnly: boolean;
  comingUp?: boolean;
  managesLibrary: boolean;
  canPublish: boolean;
  /** UNIT_BOUNDARY_DESCRIPTION: the composer + menu's Skills panel, as the design draws it: the same search, counts, groups and switches, with no skill-set or row actions and no add rows, which its footer holds; an Agent with no skill of its own shows the design's drop zone. */
  compact?: boolean;
  /** UNIT_BOUNDARY_DESCRIPTION: the + menu's read-only state for a viewer who may not change skills: the same groups, with no switches. */
  hideSwitches?: boolean;
  /** UNIT_BOUNDARY_DESCRIPTION: where the compact surface's dialogs open: the + menu draws them after it closes, so none is drawn under the menu or closed with it. */
  onOpenModal?: (modal: SkillsModal) => void;
}) {
  const isError = agentState === "error";
  const openAgentSettings = useStore((s) => s.openAgentSettings);
  const wakeAgent = useWakeAgent();
  const { hasRun, pending: configPending } = useResolvedHarnessConfig(agentId);
  const [openModal, setOpenModal] = useState<SkillsModal | null>(null);
  const showModal = (modal: SkillsModal) =>
    onOpenModal ? onOpenModal(modal) : setOpenModal(modal);
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
  const { publishes, updatingAll, updateAll, downloadStandalone } = surface;
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
  } = derived;

  const openAddSource = () =>
    showModal({ kind: "add-source", mode: "github", files: [] });
  const manageConnections = agentId
    ? () => openAgentSettings(agentId, "connections")
    : undefined;

  const ran = hasRun || surface.standaloneSnapshot !== undefined;
  const dropEnabled = !readOnly && !hideSwitches && !!agentId;
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
            showModal({ kind: "add-source", mode: "upload", files });
        },
      }
    : {};

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
        ) : (
          <SkillsReadOnlyPanel
            agentId={agentId}
            surface={surface}
            derived={derived}
            mode={ran ? "stopped" : "never-run"}
            comingUp={!!comingUp}
            onStart={() => agentId && wakeAgent.wake(agentId)}
            onAddSource={managesLibrary ? openAddSource : undefined}
            onRemove={
              managesLibrary
                ? (src) => void removeSourceWithConfirm(src)
                : undefined
            }
            onManageConnections={manageConnections}
          />
        )
      ) : (
        <>
          <div className={compact ? "mb-4" : "mb-5"}>
            <SkillsSearchHeader
              onWord={compact ? "on" : undefined}
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
                !compact &&
                managesLibrary && (
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
                    onClick={() => showModal({ kind: "save-set" })}
                  >
                    <Save size={16} /> Save as skill set…
                  </Button>
                )
              }
            />
          </div>

          <div className={cn("flex flex-col", compact ? "gap-6" : "gap-8")}>
            {(shownCreatedHere.length > 0 || !searching) && (
              <StandaloneSkillsGroup
                skills={shownCreatedHere}
                readOnly={false}
                publishes={publishes}
                canPublish={publishableSources.length > 0}
                onPublish={
                  canPublish
                    ? (skill) => showModal({ kind: "publish", skill })
                    : undefined
                }
                onDownload={(skill) => void downloadStandalone(skill)}
                onDelete={(skill, pub) =>
                  void deleteStandaloneWithConfirm(skill, pub)
                }
                onTrack={(skill, target) =>
                  void trackWithConfirm(skill, target)
                }
                onOpenSkill={
                  agentId
                    ? (skill) => showModal({ kind: "render-local", skill })
                    : undefined
                }
                trackTargets={trackTargets}
                hideRowActions={compact}
                emptyState={
                  compact && !hideSwitches ? <CompactSkillsEmpty /> : undefined
                }
                onUpload={
                  !compact && dropEnabled
                    ? () =>
                        showModal({
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
              onAddSource={
                managesLibrary
                  ? () =>
                      showModal({
                        kind: "add-source",
                        mode: "github",
                        files: [],
                      })
                  : undefined
              }
              onOpenSkill={(source, skill) =>
                showModal({ kind: "render", source, skill })
              }
              onAddSets={() => showModal({ kind: "add-sets" })}
              onToggleAll={(src, on, scope) =>
                void toggleAllWithConfirm(src, on, scope)
              }
              onRemove={
                managesLibrary
                  ? (src) => void removeSourceWithConfirm(src)
                  : undefined
              }
              onManageConnections={manageConnections}
              compact={compact}
              hideSwitches={hideSwitches}
            />
            {!managesLibrary && !compact && (
              <HiddenSourcesList
                sources={surface.hiddenSources}
                onShow={(id) => surface.setSourceHidden(id, false)}
              />
            )}

            {!compact && shownPlatform.length > 0 && (
              <PlatformSkillsGroup
                skills={shownPlatform}
                onOpenSkill={
                  agentId
                    ? (skill) => showModal({ kind: "render-local", skill })
                    : undefined
                }
                onOpenSection={
                  agentId
                    ? (section) => openAgentSettings(agentId, section)
                    : undefined
                }
              />
            )}
            {!compact && shownBuiltIn.length > 0 && (
              <LocalSkillsGroup
                label="Included with sandbox image"
                skills={shownBuiltIn}
                onOpenSkill={
                  agentId
                    ? (skill) => showModal({ kind: "render-local", skill })
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
        onPublish={
          canPublish
            ? (skill) => showModal({ kind: "publish", skill })
            : undefined
        }
        onDeleteLocal={(skill, pub) =>
          void deleteStandaloneWithConfirm(skill, pub)
        }
        onClose={() => setOpenModal(null)}
      />
    </div>
  );
}

/* UNIT_BOUNDARY_DESCRIPTION: the design's drop zone for an Agent with no skill of its own in the + menu: a dashed box, a document glyph and the three ways to get one. */
function CompactSkillsEmpty() {
  return (
    <div
      data-testid="skills-compact-empty"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center"
    >
      <Document size={16} className="text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Drop a .md file here, add a source, or describe what you need below
      </p>
    </div>
  );
}
