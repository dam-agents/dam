import { Add, Save, Upload } from "@carbon/icons-react";
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
import { skillKey, useSkillsSurface } from "../../hooks/use-skills-surface.js";
import { AddSkillSetsModal } from "./add-skill-sets-modal.js";
import { AddSkillSourceModal } from "./add-skill-source-modal.js";
import { BuiltInSkillsGroup } from "./built-in-skills-group.js";
import { LocalSkillRenderModal } from "./local-skill-render-modal.js";
import { PublishSkillModal } from "./publish-skill-modal.js";
import { publishedDuplicatesBySource } from "./published-duplicates.js";
import { SaveSkillSetModal } from "./save-skill-set-modal.js";
import { isDrifted } from "./skill-drift.js";
import { SkillDriftBanner } from "./skill-drift-banner.js";
import { SkillRenderModal } from "./skill-render-modal.js";
import { filterByQuery } from "./skill-search.js";
import { SkillSourceCard } from "./skill-source-card.js";
import { SkillsSearchHeader } from "./skills-search-header.js";
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
  const [saveSetOpen, setSaveSetOpen] = useState(false);
  const [addSetsOpen, setAddSetsOpen] = useState(false);
  // Ephemeral filter over data this component already holds. Not URL-owned:
  // routing here is path-based (routeToPath) and no route carries a query
  // param, so a bookmarkable filter would mean new routing infrastructure.
  const [query, setQuery] = useState("");
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
    busySourceId,
    updatingAll,
    installed,
    installedRef,
    toggle,
    update,
    toggleSource,
    updateAll,
    sets,
    setsFailed,
    createSet,
    applySets,
    applyingSets,
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

  // Gated on `!readOnly` at the source, not at each use: the search box only
  // renders while the sandbox is operable, and `readOnly` is poll-driven, so a
  // sandbox stopping mid-search would otherwise leave a filtered surface with
  // no control to clear it — hiding the read-only placeholder, dropping whole
  // sections, and stranding a "No skills match" line the user cannot dismiss.
  const q = readOnly ? "" : query.trim().toLowerCase();
  const searching = q.length > 0;

  // Each source's list minus its suppressed entries — the same list the card
  // renders and counts from, so the totals below can't disagree with it.
  const listBySource = useMemo(() => {
    const out = new Map<string, Skill[]>();
    for (const src of sources) {
      const scanned = skillsBySource[src.id];
      if (scanned === undefined) continue;
      const suppressed = suppressedBySource.get(src.id);
      out.set(
        src.id,
        suppressed ? scanned.filter((s) => !suppressed.has(s.name)) : scanned,
      );
    }
    return out;
  }, [sources, skillsBySource, suppressedBySource]);

  // `on` counts source-backed skills only: standalone and image-shipped ones are
  // simply present on disk, with no install to be on or off.
  const totals = useMemo(() => {
    let skills = createdHere.length + builtIn.length;
    let on = 0;
    for (const list of listBySource.values()) {
      skills += list.length;
      on += list.filter(
        (s) => installedRef(s.source, s.name) !== undefined,
      ).length;
    }
    return { skills, sources: sources.length, on };
  }, [createdHere.length, builtIn.length, listBySource, installedRef, sources]);

  const shownCreatedHere = useMemo(
    () => filterByQuery(createdHere, q),
    [createdHere, q],
  );
  const shownBuiltIn = useMemo(() => filterByQuery(builtIn, q), [builtIn, q]);
  // Matching names per source, not filtered lists: the card keeps the whole
  // source so its `N of M on` still describes the source, and shows only these
  // rows.
  const filteredBySource = useMemo(() => {
    if (!searching) return null;
    const out = new Map<string, ReadonlySet<string>>();
    for (const [id, list] of listBySource) {
      out.set(id, new Set(filterByQuery(list, q).map((s) => s.name)));
    }
    return out;
  }, [searching, listBySource, q]);

  // A source stays on screen while searching when it matched something, or when
  // it is still loading or errored — those report a condition, not content, and
  // hiding an error behind a filter reads as the filter being broken.
  const shownSources = useMemo(() => {
    if (!filteredBySource) return sources;
    return sources.filter((src) => {
      if (errorBySource[src.id]) return true;
      const matches = filteredBySource.get(src.id);
      return matches === undefined || matches.size > 0;
    });
  }, [filteredBySource, sources, errorBySource]);

  const matchCount = filteredBySource
    ? shownCreatedHere.length +
      shownBuiltIn.length +
      [...filteredBySource.values()].reduce((n, names) => n + names.size, 0)
    : null;

  // Only source-backed skills can go in a set: a set installs by name from a
  // source, and a created-here or image-shipped skill has nowhere to install
  // from. Sources with nothing scanned yet are left out rather than shown empty.
  const setGroups = useMemo(
    () =>
      sources
        .map((source) => ({
          source,
          skills: listBySource.get(source.id) ?? [],
        }))
        .filter((g) => g.skills.length > 0),
    [sources, listBySource],
  );
  const existingSetNames = useMemo(
    () => new Set(sets.map((s) => s.name)),
    [sets],
  );
  // Built with `skillKey`, the one identity helper, because the modal looks
  // these up with the same function — two hand-written spellings would have to
  // stay byte-identical forever, and a divergence fails silently by reporting
  // every entry as missing from a connected source.
  const availableKeys = useMemo(() => {
    const out = new Set<string>();
    for (const list of listBySource.values()) {
      for (const skill of list) out.add(skillKey(skill.source, skill.name));
    }
    return out;
  }, [listBySource]);
  const installedKeys = useMemo(
    () => new Set(installed.map((r) => skillKey(r.source, r.name))),
    [installed],
  );
  // Connected but unreadable — a failed scan, not a missing source. The set
  // preview words those two differently because the fix differs.
  const unreadableSources = useMemo(
    () =>
      new Set(sources.filter((s) => errorBySource[s.id]).map((s) => s.gitUrl)),
    [sources, errorBySource],
  );
  // A source that hasn't reported yet is indistinguishable from one that can't
  // serve a skill, so the set previews stay silent until every source has.
  const previewReady =
    sourcesLoaded && sources.every((s) => listBySource.has(s.id));
  const anyInstalled = totals.on > 0;

  // Drift across every source, not per card: the banner's whole point is that
  // you don't have to find the stale ones yourself.
  const drifted = useMemo(() => {
    const out: Skill[] = [];
    for (const list of listBySource.values()) {
      for (const skill of list) {
        if (isDrifted(installedRef(skill.source, skill.name), skill)) {
          out.push(skill);
        }
      }
    }
    return out;
  }, [listBySource, installedRef]);

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

  /** Enabling adds; disabling removes many skills at once, so only that
   *  direction asks. Mirrors how a standalone delete and a source removal are
   *  already gated. */
  const toggleAllWithConfirm = async (src: SkillSource, on: boolean) => {
    const list = listBySource.get(src.id) ?? [];
    if (!on) {
      const removing = list.filter(
        (s) => installedRef(s.source, s.name) !== undefined,
      ).length;
      const ok = await showConfirm(
        `${removing} skill${removing === 1 ? "" : "s"} from ${src.name} will be removed from the sandbox. You can turn them back on at any time.`,
        `Disable all skills from ${src.name}?`,
        { kind: "destructive", confirmLabel: "Disable all" },
      );
      if (!ok) return;
    }
    await toggleSource(src.id, list, on);
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

  // While stopped, `standalone` is whatever was last recorded — empty for a
  // sandbox that never ran. Either way it isn't evidence the sandbox is bare,
  // so don't collapse to the "add a source" empty state then.
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
          {/* Left out while read-only, matching the design: search and the
              per-skill toggles need a running sandbox, so a live control on a
              dead surface is worse than no control. */}
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
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAddSetsOpen(true)}
                  >
                    <Add size={14} /> Add skill sets…
                  </Button>
                  {/* Also gated on every source having reported: the modal's
                      list and its pre-marks are a one-shot snapshot, so opening
                      it mid-scan would silently save a set missing the slower
                      source's skills. */}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!anyInstalled || !previewReady}
                    title={
                      !previewReady
                        ? "Still reading your sources…"
                        : anyInstalled
                          ? undefined
                          : "Turn on at least one skill from a source to save a set"
                    }
                    onClick={() => setSaveSetOpen(true)}
                  >
                    <Save size={14} /> Save as skill set…
                  </Button>
                </>
              }
            />
          )}

          {shownCreatedHere.length > 0 ? (
            <StandaloneSkillsGroup
              skills={shownCreatedHere}
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
          ) : searching ? null : readOnly ? (
            // Stopped/starting: the list is on the offline pod, so show the
            // section with a placeholder instead of dropping it.
            <StandaloneSkillsPlaceholder />
          ) : (
            <StandaloneSkillsEmptyState action={addSourceButton} />
          )}

          {shownBuiltIn.length > 0 && (
            <BuiltInSkillsGroup
              skills={shownBuiltIn}
              onOpenSkill={agentId ? setLocalRenderFor : undefined}
            />
          )}

          {(!searching || shownSources.length > 0) && (
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <SectionLabel>Sourced from GitHub</SectionLabel>
                {addSourceButton}
              </div>
              {!sourcesLoaded ? (
                <SkillSourcesSkeleton />
              ) : sources.length === 0 ? (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-muted-foreground">
                    No skill sources connected. Add a GitHub repo to browse and
                    install its skills
                    {sets.length > 0 && " — or start from a set you've built"}.
                  </p>
                  {!readOnly && sets.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAddSetsOpen(true)}
                    >
                      <Add size={14} /> Add skill sets…
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {shownSources.map((src) => (
                    <SkillSourceCard
                      key={src.id}
                      source={src}
                      skills={skillsBySource[src.id]}
                      filteredNames={filteredBySource?.get(src.id) ?? null}
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
                      onToggleAll={(on) => void toggleAllWithConfirm(src, on)}
                      bulkBusy={busySourceId === src.id}
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
          )}
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

      {addSetsOpen && (
        <AddSkillSetsModal
          sets={sets}
          loadFailed={setsFailed}
          available={availableKeys}
          installedKeys={installedKeys}
          unreadableSources={unreadableSources}
          ready={previewReady}
          applying={applyingSets}
          onApply={applySets}
          onClose={() => setAddSetsOpen(false)}
        />
      )}

      {saveSetOpen && (
        <SaveSkillSetModal
          groups={setGroups}
          isOn={(skill) => installedRef(skill.source, skill.name) !== undefined}
          existingNames={existingSetNames}
          onCreate={createSet}
          onClose={() => setSaveSetOpen(false)}
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
