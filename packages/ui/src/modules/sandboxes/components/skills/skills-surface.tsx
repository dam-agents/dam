import type { LocalSkill, SkillRef, SkillSource } from "api-server-api";
import { Plus, Upload } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentState } from "../../../../types.js";
import { useSkillsSurface } from "../../hooks/use-skills-surface.js";
import { AddSkillSourceModal } from "./add-skill-source-modal.js";
import { PublishSkillModal } from "./publish-skill-modal.js";
import { SkillSourceCard } from "./skill-source-card.js";
import { SkillSourcesSkeleton } from "./skills-skeleton.js";
import { StandaloneSkillsGroup } from "./standalone-skills-group.js";

/**
 * The redesigned skills surface: skills grouped by location — Standalone Local
 * Skills ("Created in this sandbox") and Skill Sources ("Sourced from GitHub").
 * Toggles install/uninstall immediately; the "+ Add source" control and the
 * per-source kebab (re-scan / view repo / remove) administer sources. Read-only
 * while the agent is stopped; the container renders the wake affordance.
 */
export function SkillsSurface({
  agentId,
  agentState,
  readOnly,
  onInstalledChange,
}: {
  agentId: string | null;
  agentState: AgentState | undefined;
  readOnly: boolean;
  onInstalledChange?: (installed: SkillRef[]) => void;
}) {
  const isError = agentState === "error";
  const showConfirm = useStore((s) => s.showConfirm);
  const [addOpen, setAddOpen] = useState(false);
  const [publishFor, setPublishFor] = useState<LocalSkill | null>(null);
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
    createSource,
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

  const addSourceButton = (
    <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
      <Plus size={14} /> Add source
    </Button>
  );

  const isEmpty =
    sourcesLoaded &&
    stateLoaded &&
    sources.length === 0 &&
    standalone.length === 0;

  return (
    // Read-only (agent stopped / starting): non-interactive, with each card on
    // a muted background per the design. The add-source modal is portaled, so
    // it escapes this region.
    <div
      className={cn("flex flex-col gap-8", readOnly && "pointer-events-none")}
    >
      {isEmpty ? (
        <section>
          <SectionLabel spaced>Skills</SectionLabel>
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <Upload size={20} className="text-muted-foreground" />
            <p className="text-[14px] text-muted-foreground">
              Drop a .md file here to create a skill, or add a GitHub repo as a
              source.
            </p>
            {addSourceButton}
          </div>
        </section>
      ) : (
        <>
          {standalone.length > 0 && (
            <StandaloneSkillsGroup
              skills={standalone}
              readOnly={readOnly}
              publishes={publishes}
              canPublish={publishableSources.length > 0}
              onPublish={setPublishFor}
              action={addSourceButton}
            />
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
                    onRescan={() => void refreshSource(src.id)}
                    onRemove={() => void removeWithConfirm(src)}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {addOpen && (
        <AddSkillSourceModal
          onClose={() => setAddOpen(false)}
          onCreate={createSource}
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
    </div>
  );
}
