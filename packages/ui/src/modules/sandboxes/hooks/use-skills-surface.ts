import type {
  LocalSkill,
  ScanFailure,
  Skill,
  SkillPublishRecord,
  SkillRef,
  SkillSet,
  SkillSetApplyResult,
  SkillSource,
  SkillsState,
} from "api-server-api";
import { useCallback, useEffect, useState } from "react";

import { getErrorMessage } from "@/lib/errors";
import { toScanFailure } from "@/lib/scan-failure";

import { api } from "../../../api.js";
import { parsePlatformCta } from "../../../lib/platform-cta.js";
import { ACTION_FAILED, runAction } from "../../../lib/query-helpers.js";
import { emitToast } from "../../../lib/toast.js";
import { saveSkillFiles } from "../lib/skill-download.js";

/**
 * The identity a skill is installed and stored under. One definition for the
 * whole surface: the set-preview compares keys built in one file against keys
 * built in another, so a second spelling would silently report every entry as
 * missing rather than fail loudly.
 */
export const skillKey = (source: string, name: string) => `${source}::${name}`;

/** Turn the server's closed skip verdicts into one readable clause. The reason
 *  codes never reach the user — the client owns the wording. */
function skippedSummary(skipped: SkillSetApplyResult["skipped"]): string {
  const count = (reason: SkillSetApplyResult["skipped"][number]["reason"]) =>
    skipped.filter((s) => s.reason === reason).length;
  const clauses: [number, string][] = [
    [
      count("source-not-connected"),
      "from a source this sandbox isn't connected to",
    ],
    [count("source-unreadable"), "from a source that couldn't be read"],
    [count("not-in-source"), "no longer in its source"],
  ];
  return clauses
    .filter(([n]) => n > 0)
    .map(([n, text]) => `${n} ${text}`)
    .join(", ");
}

export interface SkillsSurface {
  sources: SkillSource[];
  /** False until the first `sources.list` resolves, so the surface can show a
   *  skeleton instead of flashing an empty "no sources" state. */
  sourcesLoaded: boolean;
  /** False until the first `skills.state` resolves, so a source card can snapshot
   *  its collapse default only once the installed set is actually known. */
  stateLoaded: boolean;
  skillsBySource: Record<string, Skill[]>;
  loadingBySource: Record<string, boolean>;
  /** Why each source's last scan failed, as the server's own verdict — never a
   *  raw message. A failure the server didn't classify becomes the generic
   *  verdict on the way in, so nothing here needs interpreting downstream. */
  errorBySource: Record<string, ScanFailure | null>;
  /** ISO 8601 time each source's list was last read from upstream; absent
   *  until that source's first successful scan. */
  scannedAtBySource: Record<string, string>;
  installed: SkillRef[];
  standalone: LocalSkill[];
  /** Publish records for this agent — drives the "Published" pill. */
  publishes: SkillPublishRecord[];
  /** Row currently mid-install/uninstall, so its toggle can show a spinner. */
  busyKey: string | null;
  /** Source with a bulk enable/disable in flight — card-wide, where `busyKey`
   *  is one row. */
  busySourceId: string | null;
  /** A cross-source "update all drifted" is in flight. */
  updatingAll: boolean;
  installedRef: (source: string, name: string) => SkillRef | undefined;
  toggle: (skill: Skill) => Promise<void>;
  /** Re-install a drifted skill at the latest scanned version, clearing drift
   *  once the installed contentHash matches the scan again. */
  update: (skill: Skill) => Promise<void>;
  /** Turn a whole source on or off in one apply cycle. Sends only the
   *  difference, so already-installed skills aren't rewritten. */
  toggleSource: (
    sourceId: string,
    skills: Skill[],
    on: boolean,
  ) => Promise<void>;
  /** Re-install every drifted skill at its latest scanned version, in one
   *  apply cycle. */
  updateAll: (drifted: Skill[]) => Promise<void>;
  /** The user's saved skill sets. Owner-scoped and sandbox-independent, so this
   *  is loaded once rather than folded into the 5s state poll. */
  sets: SkillSet[];
  /** The one load of `sets` failed. Distinct from an empty list: telling a user
   *  they have no saved sets when the request merely failed is a lie about
   *  their own data, and there is no retry short of remounting. */
  setsFailed: boolean;
  /** Save a named set. Returns whether it was created. */
  createSet: (input: {
    name: string;
    skills: { source: string; name: string }[];
  }) => Promise<boolean>;
  /** Delete a saved set. Returns whether it was removed. Sets have no rename, so
   *  this is how a typo'd name is corrected. Skills already installed from it
   *  stay installed — a set is a selection, not an owner. */
  deleteSet: (id: string) => Promise<boolean>;
  /** Add the chosen sets' skills alongside what's already on. Returns false when
   *  nothing could be applied, so the caller can keep its modal open. */
  applySets: (setIds: string[]) => Promise<boolean>;
  /** A set apply is in flight. */
  applyingSets: boolean;
  /** Publish a standalone skill upstream as a PR. Toasts the PR link on
   *  success (or a CTA on a structured upstream error). Returns success. */
  publish: (input: {
    sourceId: string;
    name: string;
    title?: string;
    body?: string;
  }) => Promise<boolean>;
  /** Add a GitHub Skill Source; returns it (and lists its skills) or null. */
  createSource: (input: {
    name: string;
    gitUrl: string;
    path?: string;
  }) => Promise<SkillSource | null>;
  /** Create standalone skills from uploaded Markdown (one per file). On a name
   *  collision returns the offending names so the modal can mark rows inline;
   *  other failures are toasted and returned with empty `conflictNames`. */
  createLocalSkills: (
    skills: { name: string; content: string }[],
  ) => Promise<
    { ok: true } | { ok: false; conflictNames: string[]; message: string }
  >;
  /** Delete a standalone skill from the sandbox. Returns whether it was
   *  removed; the mutation's result is the authoritative remaining list. */
  deleteStandalone: (skill: LocalSkill) => Promise<boolean>;
  /** Download a standalone skill's files (a lone SKILL.md as .md, else a .zip). */
  downloadStandalone: (skill: LocalSkill) => Promise<void>;
  /** Delete a Skill Source; returns whether it was removed. */
  removeSource: (id: string) => Promise<boolean>;
  /** Re-scan a source: refresh its scan cache, then re-list. The card shows a
   *  spinner (via loadingBySource) for the duration. */
  refreshSource: (id: string) => Promise<void>;
}

/**
 * Data + install/uninstall for the redesigned skills surface. Keeps the proven
 * imperative flow from the old panel: `state` is held in local state and set
 * from the mutation result, then a 5s poll folds in agent-initiated installs
 * (MCP tool calls in chat). Deliberately not react-query — a recurring
 * `skills.state` refetch lands inside the reconcile settle window and reverts an
 * in-flight toggle (#2775); the mutation result is authoritative between polls.
 */
export function useSkillsSurface(
  agentId: string | null,
  opts: {
    readOnly: boolean;
    isError: boolean;
    /** Mirrors the whole reconciled state to the nav summary's query cache —
     *  not just `installed`, or the summary goes stale on every standalone
     *  add/delete. Stable. */
    onStateChange?: (state: SkillsState) => void;
  },
): SkillsSurface {
  const { readOnly, isError, onStateChange } = opts;

  const [sources, setSources] = useState<SkillSource[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [skillsBySource, setSkillsBySource] = useState<Record<string, Skill[]>>(
    {},
  );
  const [loadingBySource, setLoadingBySource] = useState<
    Record<string, boolean>
  >({});
  const [errorBySource, setErrorBySource] = useState<
    Record<string, ScanFailure | null>
  >({});
  const [scannedAtBySource, setScannedAtBySource] = useState<
    Record<string, string>
  >({});
  const [installed, setInstalled] = useState<SkillRef[]>([]);
  const [standalone, setStandalone] = useState<LocalSkill[]>([]);
  // Set only while the pod is unreachable, when `standalone` came from a
  // recording rather than a live read.
  const [standaloneSnapshot, setStandaloneSnapshot] =
    useState<SkillsState["standaloneSnapshot"]>(undefined);
  const [publishes, setPublishes] = useState<SkillPublishRecord[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [busySourceId, setBusySourceId] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [sets, setSets] = useState<SkillSet[]>([]);
  const [setsFailed, setSetsFailed] = useState(false);
  const [applyingSets, setApplyingSets] = useState(false);

  useEffect(() => {
    // Gate on stateLoaded: before the first `skills.state` resolves all three
    // arrays are empty placeholders, and publishing those would blank a summary
    // the sidebar's own one-shot fetch already populated.
    if (!stateLoaded) return;
    onStateChange?.({
      installed,
      standalone,
      instancePublishes: publishes,
      standaloneSnapshot,
    });
  }, [
    stateLoaded,
    installed,
    standalone,
    publishes,
    standaloneSnapshot,
    onStateChange,
  ]);

  const loadSkills = useCallback(
    async (sourceId: string) => {
      // Public GitHub sources scan from the api-server (no running agent
      // needed); private sources delegate to the pod and surface a
      // PRECONDITION_FAILED, rendered as a per-source error.
      if (!agentId) return;
      setLoadingBySource((l) => ({ ...l, [sourceId]: true }));
      setErrorBySource((e) => ({ ...e, [sourceId]: null }));
      try {
        const { skills, scannedAt } = await api.skills.listWithScan.query({
          sourceId,
          agentId,
        });
        setSkillsBySource((s) => ({ ...s, [sourceId]: skills }));
        setScannedAtBySource((m) => ({ ...m, [sourceId]: scannedAt }));
      } catch (err) {
        setErrorBySource((e) => ({ ...e, [sourceId]: toScanFailure(err) }));
        setSkillsBySource((s) => ({ ...s, [sourceId]: [] }));
      } finally {
        setLoadingBySource((l) => ({ ...l, [sourceId]: false }));
      }
    },
    [agentId],
  );

  useEffect(() => {
    let cancelled = false;
    setSourcesLoaded(false);
    setStateLoaded(false);

    const refreshInstalled = async () => {
      if (!agentId) {
        if (!cancelled) {
          setInstalled([]);
          setStandalone([]);
          setPublishes([]);
          setStandaloneSnapshot(undefined);
          setStateLoaded(true);
        }
        return;
      }
      try {
        const state = await api.skills.state.query({ agentId });
        if (!cancelled) {
          setInstalled(state.installed);
          setStandalone(state.standalone);
          setPublishes(state.instancePublishes);
          setStandaloneSnapshot(state.standaloneSnapshot);
        }
      } catch {
      } finally {
        if (!cancelled) setStateLoaded(true);
      }
    };

    (async () => {
      try {
        const srcs = await api.skills.sources.list.query(
          agentId ? { agentId } : undefined,
        );
        if (!cancelled) setSources(srcs);
      } catch {
        if (!cancelled) setSources([]);
      } finally {
        if (!cancelled) setSourcesLoaded(true);
      }
    })();
    refreshInstalled();

    const iv = setInterval(refreshInstalled, 5000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [agentId]);

  useEffect(() => {
    for (const src of sources) {
      if (skillsBySource[src.id] === undefined && !loadingBySource[src.id]) {
        loadSkills(src.id);
      }
    }
  }, [sources, skillsBySource, loadingBySource, loadSkills]);

  const installedRef = useCallback(
    (source: string, name: string) =>
      installed.find((s) => s.source === source && s.name === name),
    [installed],
  );

  const toggle = useCallback(
    async (skill: Skill) => {
      if (!agentId || isError || readOnly) return;
      const key = skillKey(skill.source, skill.name);
      setBusyKey(key);
      const currentlyInstalled = !!installedRef(skill.source, skill.name);
      const result = await runAction(
        () =>
          currentlyInstalled
            ? api.skills.uninstall.mutate({
                agentId,
                source: skill.source,
                name: skill.name,
              })
            : api.skills.install.mutate({
                agentId,
                source: skill.source,
                name: skill.name,
                version: skill.version,
                contentHash: skill.contentHash,
              }),
        `Failed to ${currentlyInstalled ? "uninstall" : "install"} ${skill.name}`,
      );
      if (result !== ACTION_FAILED) setInstalled(result);
      setBusyKey(null);
    },
    [agentId, isError, readOnly, installedRef],
  );

  const update = useCallback(
    async (skill: Skill) => {
      if (!agentId || isError || readOnly) return;
      const key = skillKey(skill.source, skill.name);
      setBusyKey(key);
      // Re-install at the scanned version+hash: an already-installed skill, so
      // this is the "adopt latest" path, not a toggle (which would uninstall).
      const result = await runAction(
        () =>
          api.skills.install.mutate({
            agentId,
            source: skill.source,
            name: skill.name,
            version: skill.version,
            contentHash: skill.contentHash,
          }),
        `Failed to update ${skill.name}`,
      );
      if (result !== ACTION_FAILED) setInstalled(result);
      setBusyKey(null);
    },
    [agentId, isError, readOnly],
  );

  const toggleSource = useCallback(
    async (sourceId: string, skills: Skill[], on: boolean) => {
      if (!agentId || isError || readOnly) return;
      // Only the difference: installing an already-installed skill is a wasted
      // row write and a misleading second entry in the security log.
      const changing = skills.filter(
        (s) => !!installedRef(s.source, s.name) !== on,
      );
      if (changing.length === 0) return;
      setBusySourceId(sourceId);
      const result = await runAction(
        () =>
          api.skills.applyBatch.mutate({
            agentId,
            install: on
              ? changing.map((s) => ({
                  source: s.source,
                  name: s.name,
                  version: s.version,
                  contentHash: s.contentHash,
                }))
              : [],
            uninstall: on
              ? []
              : changing.map((s) => ({ source: s.source, name: s.name })),
          }),
        `Failed to ${on ? "enable" : "disable"} all skills`,
      );
      if (result !== ACTION_FAILED) setInstalled(result);
      setBusySourceId(null);
    },
    [agentId, isError, readOnly, installedRef],
  );

  const updateAll = useCallback(
    async (drifted: Skill[]) => {
      if (!agentId || isError || readOnly || drifted.length === 0) return;
      setUpdatingAll(true);
      // Re-install at the scanned version+hash — the "adopt latest" path, same
      // as the per-row Update, so nothing is uninstalled.
      const result = await runAction(
        () =>
          api.skills.applyBatch.mutate({
            agentId,
            install: drifted.map((s) => ({
              source: s.source,
              name: s.name,
              version: s.version,
              contentHash: s.contentHash,
            })),
            uninstall: [],
          }),
        "Failed to update all skills",
      );
      if (result !== ACTION_FAILED) setInstalled(result);
      setUpdatingAll(false);
    },
    [agentId, isError, readOnly],
  );

  // Sets belong to the user, not the sandbox, so one load rather than a place
  // in the 5s poll. Refreshed by createSet from its own result.
  useEffect(() => {
    let cancelled = false;
    api.skills.sets.list
      .query()
      .then((s) => {
        if (cancelled) return;
        setSets(s);
        setSetsFailed(false);
      })
      .catch(() => {
        // Not `setSets([])`: an empty list is a claim about the user's data,
        // and a failed read is not evidence for it.
        if (!cancelled) setSetsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const createSet = useCallback(
    async (input: {
      name: string;
      skills: { source: string; name: string }[];
    }) => {
      const result = await runAction(
        () => api.skills.sets.create.mutate(input),
        `Failed to save ${input.name}`,
      );
      if (result === ACTION_FAILED) return false;
      setSets((prev) =>
        [...prev, result].sort((a, b) => a.name.localeCompare(b.name)),
      );
      // A successful write proves the surface is reachable, so the stale
      // "couldn't load" notice must not outlive it.
      setSetsFailed(false);
      emitToast({ kind: "success", message: `Saved skill set ${result.name}` });
      return true;
    },
    [],
  );

  const deleteSet = useCallback(async (id: string) => {
    const result = await runAction(
      () => api.skills.sets.delete.mutate({ id }),
      "Failed to delete skill set",
    );
    if (result === ACTION_FAILED) return false;
    setSets((prev) => prev.filter((s) => s.id !== id));
    return true;
  }, []);

  const applySets = useCallback(
    async (setIds: string[]) => {
      if (!agentId || isError || readOnly || setIds.length === 0) return false;
      setApplyingSets(true);
      const result = await runAction(
        () => api.skills.sets.applyToAgent.mutate({ agentId, setIds }),
        "Failed to add skill sets",
      );
      setApplyingSets(false);
      if (result === ACTION_FAILED) return false;
      setInstalled(result.installed);

      const { added } = result;
      const skipped = result.skipped.length;
      // Nothing landed *and* something was refused: a plain failure, so the
      // modal stays open rather than closing on a silent no-result.
      if (added === 0 && skipped > 0) {
        emitToast({
          kind: "error",
          message: `Nothing to add — ${skippedSummary(result.skipped)}.`,
        });
        return false;
      }
      emitToast({
        kind: added === 0 ? "info" : "success",
        message:
          added === 0
            ? "Those skills are already on."
            : `Turned on ${added} skill${added === 1 ? "" : "s"}` +
              (skipped > 0
                ? `. Skipped ${skippedSummary(result.skipped)}.`
                : ""),
      });
      return true;
    },
    [agentId, isError, readOnly],
  );

  const createSource = useCallback(
    async (input: { name: string; gitUrl: string; path?: string }) => {
      const result = await runAction(
        () =>
          api.skills.sources.create.mutate({
            name: input.name.trim(),
            gitUrl: input.gitUrl.trim(),
            path: input.path?.trim() || undefined,
          }),
        "Failed to add source",
      );
      if (result === ACTION_FAILED) return null;
      // Appending drives the load effect to scan the new source's skills.
      setSources((s) => [...s, result]);
      return result;
    },
    [],
  );

  const createLocalSkills = useCallback(
    async (skills: { name: string; content: string }[]) => {
      if (!agentId) {
        return {
          ok: false as const,
          conflictNames: [],
          message: "No sandbox selected",
        };
      }
      try {
        const created = await api.skills.createLocal.mutate({
          agentId,
          skills,
        });
        // Merge ahead of the 5s poll so the new skills show immediately;
        // dedupe by name (a created skill replaces any same-named entry).
        setStandalone((prev) => {
          const byName = new Map(prev.map((s) => [s.name, s]));
          for (const s of created) byName.set(s.name, s);
          return [...byName.values()];
        });
        emitToast({
          kind: "success",
          message: `Added ${created.length} skill${created.length === 1 ? "" : "s"}`,
        });
        return { ok: true as const };
      } catch (err) {
        const message = getErrorMessage(err, "Failed to add skills");
        // CONFLICT message shape from slice 01: `skill(s) already exist: A, B`.
        // Intersect the parsed tail with the submitted names so a name that is a
        // substring of another can't mis-mark the wrong row. A name containing a
        // comma won't match any token and simply falls back to the top-level
        // error (the modal still shows the message), which is acceptable.
        const isConflict = /already exist/i.test(message);
        const submitted = new Set(skills.map((s) => s.name));
        const conflictNames = isConflict
          ? message
              .slice(message.indexOf(":") + 1)
              .split(",")
              .map((n) => n.trim())
              .filter((n) => submitted.has(n))
          : [];
        // Conflicts render inline on the offending rows; everything else toasts.
        if (!isConflict) emitToast({ kind: "error", message });
        return { ok: false as const, conflictNames, message };
      }
    },
    [agentId],
  );

  const deleteStandalone = useCallback(
    async (skill: LocalSkill) => {
      if (!agentId) return false;
      const result = await runAction(
        () => api.skills.deleteLocal.mutate({ agentId, name: skill.name }),
        `Failed to delete ${skill.name}`,
      );
      if (result === ACTION_FAILED) return false;
      setStandalone(result);
      emitToast({ kind: "success", message: `Deleted ${skill.name}` });
      return true;
    },
    [agentId],
  );

  const downloadStandalone = useCallback(
    async (skill: LocalSkill) => {
      if (!agentId) return;
      // runAction already toasts failures, including the pod's
      // PAYLOAD_TOO_LARGE for a skill over the 5 MB cap. No success toast —
      // the browser's download is the feedback.
      const result = await runAction(
        () => api.skills.readLocal.query({ agentId, name: skill.name }),
        `Failed to download ${skill.name}`,
      );
      if (result !== ACTION_FAILED) saveSkillFiles(result);
    },
    [agentId],
  );

  const removeSource = useCallback(async (id: string) => {
    const result = await runAction(
      () => api.skills.sources.delete.mutate({ id }),
      "Failed to remove source",
    );
    if (result === ACTION_FAILED) return false;
    setSources((s) => s.filter((x) => x.id !== id));
    setSkillsBySource((s) => {
      const next = { ...s };
      delete next[id];
      return next;
    });
    setScannedAtBySource((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    return true;
  }, []);

  const refreshSource = useCallback(
    async (id: string) => {
      setLoadingBySource((l) => ({ ...l, [id]: true }));
      const ok = await runAction(
        () => api.skills.sources.refresh.mutate({ id }),
        "Failed to re-scan source",
      );
      if (ok === ACTION_FAILED) {
        setLoadingBySource((l) => ({ ...l, [id]: false }));
        return;
      }
      await loadSkills(id);
    },
    [loadSkills],
  );

  const publish = useCallback(
    async (input: {
      sourceId: string;
      name: string;
      title?: string;
      body?: string;
    }) => {
      if (!agentId) return false;
      try {
        const result = await api.skills.publish.mutate({
          agentId,
          sourceId: input.sourceId,
          name: input.name,
          title: input.title?.trim() || undefined,
          body: input.body?.trim() || undefined,
        });
        emitToast({
          kind: "success",
          message: `Published ${input.name}`,
          action: {
            label: "View PR",
            onClick: () => window.open(result.prUrl, "_blank"),
          },
          ttl: 10_000,
        });
        // Optimistically record the publish so the "Published" pill shows now,
        // ahead of the next state poll; drop the target's scan cache so the
        // merged skill surfaces on the next list.
        const src = sources.find((s) => s.id === input.sourceId);
        setPublishes((p) => [
          ...p,
          {
            skillName: input.name,
            sourceId: input.sourceId,
            sourceName: src?.name ?? "",
            sourceGitUrl: src?.gitUrl ?? "",
            prUrl: result.prUrl,
            publishedAt: new Date().toISOString(),
            // Nothing has read the pull request back yet, so the optimistic
            // record claims no state.
            prState: null,
            prStateCheckedAt: null,
          },
        ]);
        void refreshSource(input.sourceId);
        return true;
      } catch (err) {
        const raw = getErrorMessage(err, `Failed to publish ${input.name}`);
        const { message, cta } = parsePlatformCta(raw);
        emitToast({
          kind: "error",
          message,
          action: cta
            ? { label: "Fix it", onClick: () => window.open(cta, "_blank") }
            : undefined,
          ttl: 15_000,
        });
        return false;
      }
    },
    [agentId, sources, refreshSource],
  );

  return {
    sources,
    sourcesLoaded,
    stateLoaded,
    skillsBySource,
    loadingBySource,
    errorBySource,
    scannedAtBySource,
    installed,
    standalone,
    publishes,
    busyKey,
    busySourceId,
    updatingAll,
    installedRef,
    toggle,
    update,
    toggleSource,
    updateAll,
    sets,
    setsFailed,
    createSet,
    deleteSet,
    applySets,
    applyingSets,
    createSource,
    createLocalSkills,
    deleteStandalone,
    downloadStandalone,
    removeSource,
    refreshSource,
    publish,
  };
}
