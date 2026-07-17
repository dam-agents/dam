import type { LocalSkill, Skill, SkillRef, SkillSource } from "api-server-api";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../../store.js";
import type { AgentState } from "../../../../types.js";
import { useSkillsSurface } from "../../hooks/use-skills-surface.js";
import { AddSkillSourceModal } from "./add-skill-source-modal.js";
import { PublishSkillModal } from "./publish-skill-modal.js";
import { SkillRenderModal } from "./skill-render-modal.js";
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

  // Source administration works without a running pod (it's account-scoped and
  // public scans run from the api-server), so "Add source" stays live even while
  // the agent is stopped — only pod-dependent actions (install/uninstall/update)
  // are gated (see `readOnly` on the skill rows).
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
    <div className="flex flex-col gap-8">
      {isEmpty ? (
        <section>
          <SectionLabel spaced>Skills</SectionLabel>
          {/* The design's empty state also invites dropping a `.md` file to
              create a skill, but that upload path isn't built yet (deferred),
              so the copy only promises what works today — adding a source.
              Restore the drop affordance when the upload backend lands. */}
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <p className="text-[14px] text-muted-foreground">
              Add a GitHub repo as a source to install skills into this sandbox.
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
                    onUpdate={update}
                    onRescan={() => void refreshSource(src.id)}
                    onRemove={() => void removeWithConfirm(src)}
                    onOpenSkill={(skill) =>
                      setRenderFor({ source: src, skill })
                    }
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
