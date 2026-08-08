import { Add, Upload } from "@carbon/icons-react";
import type {
  LocalSkill,
  Skill,
  SkillPublishRecord,
  SkillSource,
  SkillsState,
} from "api-server-api";
import type { DragEvent } from "react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";
import { externalLinkProps } from "@/lib/external-link";
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentState } from "../../../../types.js";
import { useSkillsSurface } from "../../hooks/use-skills-surface.js";
import { AddSkillSourceModal } from "./add-skill-source-modal.js";
import { BuiltInSkillsGroup } from "./built-in-skills-group.js";
import { LocalSkillRenderModal } from "./local-skill-render-modal.js";
import { PublishSkillModal } from "./publish-skill-modal.js";
import { publishedDuplicatesBySource } from "./published-duplicates.js";
import { SkillRenderModal } from "./skill-render-modal.js";
import { SkillSourceCard } from "./skill-source-card.js";
import { SkillSourcesSkeleton } from "./skills-skeleton.js";
import {
  StandaloneSkillsEmptyState,
  StandaloneSkillsGroup,
  StandaloneSkillsPlaceholder,
} from "./standalone-skills-group.js";

/**
 * The redesigned skills surface: skills grouped by provenance — user-authored
 * Standalone Local Skills ("Created in this sandbox"), image-shipped ones
 * ("Included with sandbox image"), and Skill Sources ("Sourced from GitHub").
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
  onStateChange,
}: {
  agentId: string | null;
  agentState: AgentState | undefined;
  readOnly: boolean;
  /** Agent is coming up (starting) — still read-only, but rendered a touch
   *  less dimmed than a full stop to signal it's on its way. */
  comingUp?: boolean;
  onStateChange?: (state: SkillsState) => void;
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
  const [localRenderFor, setLocalRenderFor] = useState<LocalSkill | null>(null);
  const {
    sources,
    sourcesLoaded,
    stateLoaded,
    skillsBySource,
    loadingBySource,
    errorBySource,
    scannedAtBySource,
    standalone,
    publishes,
    busyKey,
    installedRef,
    toggle,
    update,
    createSource,
    createLocalSkills,
    deleteStandalone,
    downloadStandalone,
    removeSource,
    refreshSource,
    publish,
  } = useSkillsSurface(agentId, { readOnly, isError, onStateChange });

  const publishableSources = sources.filter((s) => s.canPublish);

  // Missing origin (pre-provenance agent image) counts as user-authored.
  const createdHere = standalone.filter(
    (s) => s.origin === undefined || s.origin === "user",
  );
  const builtIn = standalone.filter(
    (s) => s.origin === "system" || s.origin === "system-modified",
  );

  const suppressedBySource = useMemo(
    () => publishedDuplicatesBySource(standalone, publishes, skillsBySource),
    [standalone, publishes, skillsBySource],
  );

  // Tracking stays gated on `merged`, unlike the suppression above: it *writes*
  // — install overwrites the local copy — so waiting until the pull request is
  // known to have landed is worth it, where hiding a redundant row is not.
  //
  // A merged skill whose source hasn't produced a listing yet: we can't tell
  // whether the local copy diverged, so tracking is disabled rather than
  // guessed at.
  const trackUnavailableNames = useMemo(() => {
    const out = new Set<string>();
    for (const p of publishes) {
      if (p.prState !== "merged") continue;
      const scanned = skillsBySource[p.sourceId]?.find(
        (s) => s.name === p.skillName,
      );
      if (!scanned) out.add(p.skillName);
    }
    return out;
  }, [publishes, skillsBySource]);

  const deleteWithConfirm = async (
    skill: LocalSkill,
    pub?: SkillPublishRecord,
  ) => {
    // Nothing here knows the PR's state, so the wording stays state-neutral —
    // "isn't withdrawn", not "is still open" (#3019).
    const ok = await showConfirm(
      <>
        This skill will be removed from the sandbox.
        {pub && (
          // Leading space joins this onto the sentence above: JSX drops the
          // newline whitespace that would otherwise separate them.
          <>
            {" The "}
            <a href={pub.prUrl} {...externalLinkProps} className="underline">
              pull request
            </a>{" "}
            you published to {pub.sourceName} isn't withdrawn.
          </>
        )}
      </>,
      `Delete ${skill.name}?`,
      { kind: "destructive", confirmLabel: "Delete skill" },
    );
    if (ok) await deleteStandalone(skill);
  };

  /**
   * Hand a merged skill over to its source. This is a governance change, not
   * housekeeping — once tracked, a future install overwrites the local copy —
   * so it is an explicit action with a confirm that states what will happen,
   * rather than something that fires on a schedule.
   */
  const trackWithConfirm = async (
    skill: LocalSkill,
    pub: SkillPublishRecord,
  ) => {
    const scanned = skillsBySource[pub.sourceId]?.find(
      (s) => s.name === skill.name,
    );
    // The kebab item is disabled in this case; guard anyway rather than guess.
    if (!scanned) return;
    const diverged = skill.contentHash !== scanned.contentHash;
    const ok = await showConfirm(
      diverged ? (
        <>
          Your local copy differs from the version in {pub.sourceName}. Tracking
          replaces it with the published version and your local changes are
          lost. To contribute them instead, use <strong>Publish again</strong>.
        </>
      ) : (
        <>
          This skill will be tracked from {pub.sourceName}. Updates published
          there will keep it current.
        </>
      ),
      `Track ${skill.name} from ${pub.sourceName}?`,
      diverged
        ? { kind: "destructive", confirmLabel: "Replace and track" }
        : { confirmLabel: "Track skill" },
    );
    if (!ok) return;
    // The existing install path is the migration: it fetches the skill at a
    // version, writes it into every Skill Path, and upserts the agent_skills
    // row — so no second writer of that row is introduced.
    await update(scanned);
    emitToast({
      kind: "success",
      message: `Tracking ${skill.name} from ${pub.sourceName}`,
    });
  };

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
      <Add size={14} /> Add source
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
          {createdHere.length > 0 ? (
            <StandaloneSkillsGroup
              skills={createdHere}
              readOnly={readOnly}
              publishes={publishes}
              canPublish={publishableSources.length > 0}
              onPublish={setPublishFor}
              onDownload={(skill) => void downloadStandalone(skill)}
              onDelete={(skill, pub) => void deleteWithConfirm(skill, pub)}
              onTrack={(skill, pub) => void trackWithConfirm(skill, pub)}
              onOpenSkill={agentId ? setLocalRenderFor : undefined}
              trackUnavailableNames={trackUnavailableNames}
              action={addSourceButton}
            />
          ) : readOnly ? (
            // Stopped/starting: the list is on the offline pod, so show the
            // section with a placeholder instead of dropping it.
            <StandaloneSkillsPlaceholder />
          ) : (
            <StandaloneSkillsEmptyState action={addSourceButton} />
          )}

          {builtIn.length > 0 && (
            <BuiltInSkillsGroup
              skills={builtIn}
              onOpenSkill={agentId ? setLocalRenderFor : undefined}
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
              <p className="text-sm text-muted-foreground">
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
                    scannedAt={scannedAtBySource[src.id]}
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
                    suppressedNames={suppressedBySource.get(src.id)}
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

      {localRenderFor && agentId && (
        <LocalSkillRenderModal
          skill={localRenderFor}
          agentId={agentId}
          onClose={() => setLocalRenderFor(null)}
        />
      )}
    </div>
  );
}
