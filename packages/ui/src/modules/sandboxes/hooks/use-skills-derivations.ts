import type { LocalSkill, Skill, SkillSource } from "api-server-api";
import { skillKey } from "api-server-api";
import { useMemo } from "react";

import { publishedDuplicatesBySource } from "../components/skills/published-duplicates.js";
import type { SaveSetGroup } from "../components/skills/save-skill-set-modal.js";
import { isDrifted } from "../components/skills/skill-drift.js";
import { filterByQuery } from "../components/skills/skill-search.js";
import type { SkillsSurface } from "./use-skills-surface.js";

export interface SkillsDerivations {
  /** The live filter: the trimmed, lowercased query, or "" while read-only. */
  q: string;
  searching: boolean;
  /** Sources that can take a published skill. */
  publishableSources: SkillSource[];
  /** Each source's list minus the entries a Standalone copy supersedes. */
  listBySource: ReadonlyMap<string, Skill[]>;
  suppressedBySource: ReadonlyMap<string, ReadonlySet<string>>;
  totals: { skills: number; sources: number; on: number };
  shownCreatedHere: LocalSkill[];
  shownBuiltIn: LocalSkill[];
  /** Matching skill names per source while searching, else null. */
  filteredBySource: ReadonlyMap<string, ReadonlySet<string>> | null;
  shownSources: SkillSource[];
  /** How many skills the query matched, or null when not searching. */
  matchCount: number | null;
  setGroups: SaveSetGroup[];
  existingSetNames: ReadonlySet<string>;
  availableKeys: ReadonlySet<string>;
  installedKeys: ReadonlySet<string>;
  unreadableSources: ReadonlySet<string>;
  /** Unreadable sources that still have skills installed here, with how many.
   *  The Save dialog offers only scanned skills, so these are the ones it must
   *  name rather than silently drop from "what's on here". */
  saveOmitted: { source: SkillSource; count: number }[];
  previewReady: boolean;
  anyInstalled: boolean;
  drifted: Skill[];
  trackUnavailableNames: ReadonlySet<string>;
}

/**
 * Everything the skills surface renders that is a projection of what
 * {@link SkillsSurface} already holds — the search filter, the per-source lists,
 * the totals, and the inputs the set dialogs preview from.
 *
 * Lives outside the component because a 5s poll re-renders it continuously: any
 * derived array the surface builds inline gets a new identity on every tick,
 * which both defeats the memos that depend on it and denies child components a
 * stable prop.
 */
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

  // Missing origin (pre-provenance agent image) counts as user-authored.
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
      for (const skill of list) out.add(skillKey(skill));
    }
    return out;
  }, [listBySource]);
  const installedKeys = useMemo(
    () => new Set(installed.map((r) => skillKey(r))),
    [installed],
  );
  // Connected but unreadable — a failed scan, not a missing source. The set
  // preview words those two differently because the fix differs.
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
  // A source that hasn't reported yet is indistinguishable from one that can't
  // serve a skill, so the set previews stay silent until every source has.
  // An errored source counts as reported: blocking on it would freeze both set
  // dialogs for as long as it stays broken, when they can name it instead.
  const previewReady =
    sourcesLoaded && sources.every((s) => listBySource.has(s.id));

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
  };
}
