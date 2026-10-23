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
import { skillKey } from "api-server-api";
import { useCallback, useEffect, useState } from "react";

import { getErrorMessage } from "@/lib/errors";
import { toScanFailure } from "@/lib/scan-failure";

import { api } from "../../../api.js";
import { parsePlatformCta } from "../../../lib/platform-cta.js";
import { ACTION_FAILED, runAction } from "../../../lib/query-helpers.js";
import { emitToast } from "../../../lib/toast.js";
import { saveSkillFiles } from "../lib/skill-download.js";

function skippedSummary(skipped: SkillSetApplyResult["skipped"]): string {
  const count = (reason: SkillSetApplyResult["skipped"][number]["reason"]) =>
    skipped.filter((s) => s.reason === reason).length;
  const clauses: [number, string][] = [
    [
      count("source-not-connected"),
      "from a source this agent isn't connected to",
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
  sourcesLoaded: boolean;
  stateLoaded: boolean;
  skillsBySource: Record<string, Skill[]>;
  loadingBySource: Record<string, boolean>;
  errorBySource: Record<string, ScanFailure | null>;
  scannedAtBySource: Record<string, string>;
  visibilityBySource: Record<string, "public" | "private">;
  installed: SkillRef[];
  standalone: LocalSkill[];
  standaloneSnapshot: SkillsState["standaloneSnapshot"];
  publishes: SkillPublishRecord[];
  mutationsDisabled: boolean;
  busyKey: string | null;
  busySourceId: string | null;
  updatingAll: boolean;
  installedRef: (source: string, name: string) => SkillRef | undefined;
  toggle: (skill: Skill) => Promise<void>;
  update: (skill: Skill) => Promise<boolean>;
  toggleSource: (
    sourceId: string,
    skills: Skill[],
    on: boolean,
  ) => Promise<void>;
  updateAll: (drifted: Skill[]) => Promise<void>;
  sets: SkillSet[];
  setsFailed: boolean;
  createSet: (input: {
    name: string;
    skills: { source: string; name: string }[];
  }) => Promise<boolean>;
  deleteSet: (id: string) => Promise<boolean>;
  applySets: (setIds: string[]) => Promise<boolean>;
  applyingSets: boolean;
  publish: (input: {
    sourceId: string;
    name: string;
    title?: string;
    body?: string;
  }) => Promise<boolean>;
  createSource: (input: {
    name: string;
    gitUrl: string;
    path?: string;
  }) => Promise<SkillSource | null>;
  createLocalSkills: (
    skills: { name: string; content: string }[],
  ) => Promise<
    { ok: true } | { ok: false; conflictNames: string[]; message: string }
  >;
  deleteStandalone: (skill: LocalSkill) => Promise<boolean>;
  downloadStandalone: (skill: LocalSkill) => Promise<void>;
  removeSource: (id: string) => Promise<boolean>;
  refreshSource: (id: string) => Promise<void>;
}

export function useSkillsSurface(
  agentId: string | null,
  opts: {
    readOnly: boolean;
    isError: boolean;
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
  const [visibilityBySource, setVisibilityBySource] = useState<
    Record<string, "public" | "private">
  >({});
  const [installed, setInstalled] = useState<SkillRef[]>([]);
  const [standalone, setStandalone] = useState<LocalSkill[]>([]);
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
      if (!agentId) return;
      setLoadingBySource((l) => ({ ...l, [sourceId]: true }));
      setErrorBySource((e) => ({ ...e, [sourceId]: null }));
      try {
        const { skills, scannedAt, visibility } =
          await api.skills.listWithScan.query({ sourceId, agentId });
        setSkillsBySource((s) => ({ ...s, [sourceId]: skills }));
        setScannedAtBySource((m) => ({ ...m, [sourceId]: scannedAt }));
        if (visibility) {
          setVisibilityBySource((m) => ({ ...m, [sourceId]: visibility }));
        }
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
      const key = skillKey(skill);
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
      if (!agentId || isError || readOnly) return false;
      const key = skillKey(skill);
      setBusyKey(key);
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
      return result !== ACTION_FAILED;
    },
    [agentId, isError, readOnly],
  );

  const toggleSource = useCallback(
    async (sourceId: string, skills: Skill[], on: boolean) => {
      if (!agentId || isError || readOnly) return;
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
          message: "No agent selected",
        };
      }
      try {
        const created = await api.skills.createLocal.mutate({
          agentId,
          skills,
        });
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
        const isConflict = /already exist/i.test(message);
        const submitted = new Set(skills.map((s) => s.name));
        const conflictNames = isConflict
          ? message
              .slice(message.indexOf(":") + 1)
              .split(",")
              .map((n) => n.trim())
              .filter((n) => submitted.has(n))
          : [];
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
    visibilityBySource,
    installed,
    standalone,
    standaloneSnapshot,
    publishes,
    mutationsDisabled: !agentId || isError || readOnly,
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
