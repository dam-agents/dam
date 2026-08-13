import type { LocalSkill, Skill, SkillSource } from "api-server-api";
import { skillKey } from "api-server-api";
import { useMemo } from "react";

import { repoSlug } from "@/lib/git-source";

import { publishedDuplicatesBySource } from "../components/skills/published-duplicates.js";
import type { SaveSetGroup } from "../components/skills/save-skill-set-modal.js";
import { isDrifted } from "../components/skills/skill-drift.js";
import { filterByQuery } from "../components/skills/skill-search.js";
import type { SkillsSurface } from "./use-skills-surface.js";

export interface SkillsDerivations {
  q: string;
  searching: boolean;
  publishableSources: SkillSource[];
  listBySource: ReadonlyMap<string, Skill[]>;
  suppressedBySource: ReadonlyMap<string, ReadonlySet<string>>;
  totals: { skills: number; sources: number; on: number };
  shownCreatedHere: LocalSkill[];
  shownBuiltIn: LocalSkill[];
  filteredBySource: ReadonlyMap<string, ReadonlySet<string>> | null;
  shownSources: SkillSource[];
  matchCount: number | null;
  setGroups: SaveSetGroup[];
  existingSetNames: ReadonlySet<string>;
  availableKeys: ReadonlySet<string>;
  installedKeys: ReadonlySet<string>;
  unreadableSources: ReadonlySet<string>;
  saveOmitted: { source: SkillSource; count: number }[];
  previewReady: boolean;
  anyInstalled: boolean;
  drifted: Skill[];
  trackUnavailableNames: ReadonlySet<string>;
  /** What was on at the last run, grouped for the stopped snapshot panel:
   *  created-here, then one row per source, then image-shipped. */
  snapshotRows: { label: string; names: string[] }[];
  /** How many source-backed skills were installed at the last run. The same
   *  measure as the running surface's `on`, so the number doesn't jump when a
   *  sandbox stops — and the same one the per-source rows below it add up to.
   *  Created-here and image skills are provenance, not toggles. */
  snapshotOnCount: number;
}

export function useSkillsDerivations(
  surface: SkillsSurface,
  opts: { readOnly: boolean; query: string },
): SkillsDerivations {
  const {
    sources,
    sourcesLoaded,
    skillsBySource,
    errorBySource,
    standalone,
    publishes,
    installed,
    installedRef,
    sets,
  } = surface;
  const { readOnly, query } = opts;

  const publishableSources = useMemo(
    () => sources.filter((s) => s.canPublish),
    [sources],
  );

  const createdHere = useMemo(
    () =>
      standalone.filter((s) => s.origin === undefined || s.origin === "user"),
    [standalone],
  );
  const builtIn = useMemo(
    () =>
      standalone.filter(
        (s) => s.origin === "system" || s.origin === "system-modified",
      ),
    [standalone],
  );

  const suppressedBySource = useMemo(
    () => publishedDuplicatesBySource(standalone, publishes, skillsBySource),
    [standalone, publishes, skillsBySource],
  );

  const q = readOnly ? "" : query.trim().toLowerCase();
  const searching = q.length > 0;

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
  const filteredBySource = useMemo(() => {
    if (!searching) return null;
    const out = new Map<string, ReadonlySet<string>>();
    for (const [id, list] of listBySource) {
      out.set(id, new Set(filterByQuery(list, q).map((s) => s.name)));
    }
    return out;
  }, [searching, listBySource, q]);

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
  const availableKeys = useMemo(() => {
    const out = new Set<string>();
    for (const list of listBySource.values()) {
      for (const skill of list) out.add(skillKey(skill));
    }
    return out;
  }, [listBySource]);
  const installedKeys = useMemo(
    () => new Set(installed.map((r) => skillKey(r))),
    [installed],
  );
  const unreadableSources = useMemo(
    () =>
      new Set(sources.filter((s) => errorBySource[s.id]).map((s) => s.gitUrl)),
    [sources, errorBySource],
  );
  const saveOmitted = useMemo(() => {
    const out: { source: SkillSource; count: number }[] = [];
    for (const src of sources) {
      if (!errorBySource[src.id]) continue;
      const count = installed.filter((r) => r.source === src.gitUrl).length;
      if (count > 0) out.push({ source: src, count });
    }
    return out;
  }, [sources, errorBySource, installed]);
  const previewReady =
    sourcesLoaded && sources.every((s) => listBySource.has(s.id));

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

  // Reads from `installed` (Postgres, always current) and `standalone` (the
  // recording, while stopped) — never from a scan, which needs the pod that is
  // by definition not there.
  const snapshotRows = useMemo(() => {
    const rows: { label: string; names: string[] }[] = [];
    if (createdHere.length > 0) {
      rows.push({
        label: "Created here",
        names: createdHere.map((s) => s.name),
      });
    }
    const byUrl = new Map<string, string[]>();
    for (const ref of installed) {
      const names = byUrl.get(ref.source);
      if (names) names.push(ref.name);
      else byUrl.set(ref.source, [ref.name]);
    }
    for (const src of sources) {
      const names = byUrl.get(src.gitUrl);
      if (names && names.length > 0) rows.push({ label: src.name, names });
      byUrl.delete(src.gitUrl);
    }
    // Installed from a source that has since been disconnected. Listed under
    // its URL rather than dropped: the skills are still on disk, and a row
    // that silently vanishes reads as data loss.
    for (const [gitUrl, names] of byUrl) {
      rows.push({ label: repoSlug(gitUrl), names });
    }
    if (builtIn.length > 0) {
      rows.push({ label: "With the image", names: builtIn.map((s) => s.name) });
    }
    return rows;
  }, [createdHere, builtIn, installed, sources]);

  return {
    q,
    searching,
    publishableSources,
    listBySource,
    suppressedBySource,
    totals,
    shownCreatedHere,
    shownBuiltIn,
    filteredBySource,
    shownSources,
    matchCount,
    setGroups,
    existingSetNames,
    availableKeys,
    installedKeys,
    unreadableSources,
    saveOmitted,
    previewReady,
    anyInstalled: totals.on > 0,
    drifted,
    trackUnavailableNames,
    snapshotRows,
    snapshotOnCount: installed.length,
  };
}
