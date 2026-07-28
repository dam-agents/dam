import type { LocalSkill, Skill, SkillRef, SkillSource } from "api-server-api";
import { Plus, Upload } from "lucide-react";
import type { DragEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentState } from "../../../../types.js";
import { useSkillsSurface } from "../../hooks/use-skills-surface.js";
import { AddSkillSourceModal } from "./add-skill-source-modal.js";
import { PublishSkillModal } from "./publish-skill-modal.js";
import { SkillRenderModal } from "./skill-render-modal.js";
import { SkillSourceCard } from "./skill-source-card.js";
import { SkillSourcesSkeleton } from "./skills-skeleton.js";
import {
  StandaloneSkillsGroup,
  StandaloneSkillsPlaceholder,
} from "./standalone-skills-group.js";

/**
 * The redesigned skills surface: skills grouped by location — Standalone Local
 * Skills ("Created in this sandbox") and Skill Sources ("Sourced from GitHub").
 * Toggles install/uninstall immediately; the "+ Add source" control and the
 * per-source kebab (re-scan / view repo / remove) administer sources. While the
 * agent is stopped/starting the whole surface is a dimmed, non-interactive
 * read-only snapshot; the container renders the wake affordance.
 */
export function SkillsSurface({
  agentId,
  agentState,
  readOnly,
  comingUp,
  onInstalledChange,
}: {
  agentId: string | null;
  agentState: AgentState | undefined;
  readOnly: boolean;
  /** Agent is coming up (starting) — still read-only, but rendered a touch
   *  less dimmed than a full stop to signal it's on its way. */
  comingUp?: boolean;
  onInstalledChange?: (installed: SkillRef[]) => void;
}) {
  const isError = agentState === "error";
  const showConfirm = useStore((s) => s.showConfirm);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const [modal, setModal] = useState<{
    tab: "github" | "upload";
    files: File[];
  } | null>(null);
  const [pageDrag, setPageDrag] = useState(false);
  const [publishFor, setPublishFor] = useState<LocalSkill | null>(null);
  const [renderFor, setRenderFor] = useState<{
    source: SkillSource;
    skill: Skill;
  } | null>(null);
  const {
    sources,
    sourcesLoaded,
    stateLoaded,
    skillsBySource,
    loadingBySource,
    errorBySource,
    standalone,
    publishes,
    busyKey,
    installedRef,
    toggle,
    update,
    createSource,
    createLocalSkills,
    removeSource,
    refreshSource,
    publish,
  } = useSkillsSurface(agentId, { readOnly, isError, onInstalledChange });

  const publishableSources = sources.filter((s) => s.canPublish);

  const removeWithConfirm = async (src: SkillSource) => {
    const ok = await showConfirm(
      "This skill source will be removed, you will need to add the github source url again to re-access these skills.",
      `Delete ${src.name}?`,
      { kind: "destructive", confirmLabel: "Delete connection" },
    );
    if (ok) await removeSource(src.id);
  };

  // Read-only while the agent is stopped/starting (matches the design):
  // administering sources is a running-agent action, so drop "Add source"
  // rather than dim a dead control.
  const addSourceButton = readOnly ? null : (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setModal({ tab: "github", files: [] })}
    >
      <Plus size={14} /> Add source
    </Button>
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
          if (files.length > 0) setModal({ tab: "upload", files });
        },
      }
    : {};

  // While stopped, `standalone` is always empty (the list lives on the offline
  // pod), so an empty standalone list isn't evidence the sandbox is bare —
  // don't collapse to the "add a source" empty state then.
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
        // Stopped / starting: a dimmed, non-interactive read-only snapshot.
        // Per Figma: rows at 40% opacity when stopped, 60% while starting.
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
              <p className="text-[14px] text-muted-foreground">
                Drop a .md file here to create a skill, or add a GitHub repo as
                a source.
              </p>
              {addSourceButton}
            </div>
          </Callout>
        </section>
      ) : (
        <>
          {standalone.length > 0 ? (
            <StandaloneSkillsGroup
              skills={standalone}
              readOnly={readOnly}
              publishes={publishes}
              canPublish={publishableSources.length > 0}
              onPublish={setPublishFor}
              action={addSourceButton}
            />
          ) : (
            // Stopped/starting: the list is on the offline pod, so show the
            // section with a placeholder instead of dropping it.
            readOnly && <StandaloneSkillsPlaceholder />
          )}

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <SectionLabel>Sourced from GitHub</SectionLabel>
              {addSourceButton}
            </div>
            {!sourcesLoaded ? (
              <SkillSourcesSkeleton />
            ) : sources.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No skill sources connected.
              </p>
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
                    busyKey={busyKey}
                    disabled={!agentId || isError}
                    stateLoaded={stateLoaded}
                    readOnly={readOnly}
                    onToggle={toggle}
                    onUpdate={update}
                    onRescan={() => void refreshSource(src.id)}
                    onRemove={() => void removeWithConfirm(src)}
                    onOpenSkill={(skill) =>
                      setRenderFor({ source: src, skill })
                    }
                    onManageConnections={
                      agentId
                        ? () => navigateToSandboxHome(agentId, "connections")
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {modal && (
        <AddSkillSourceModal
          onClose={() => setModal(null)}
          onCreate={createSource}
          onCreateSkills={createLocalSkills}
          initialTab={modal.tab}
          initialFiles={modal.files}
        />
      )}

      {publishFor && (
        <PublishSkillModal
          skill={publishFor}
          sources={publishableSources}
          onPublish={publish}
          onClose={() => setPublishFor(null)}
        />
      )}

      {renderFor && (
        <SkillRenderModal
          source={renderFor.source}
          skill={renderFor.skill}
          agentId={agentId}
          onClose={() => setRenderFor(null)}
        />
      )}
    </div>
  );
}
