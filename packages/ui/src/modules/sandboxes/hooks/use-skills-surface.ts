import type {
  LocalSkill,
  Skill,
  SkillPublishRecord,
  SkillRef,
  SkillSource,
} from "api-server-api";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../../api.js";
import { ACTION_FAILED, runAction } from "../../../lib/query-helpers.js";

/** Row identity shared by the surface and its child components. */
export const skillKey = (source: string, name: string) => `${source}::${name}`;

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
  errorBySource: Record<string, string | null>;
  installed: SkillRef[];
  standalone: LocalSkill[];
  publishes: SkillPublishRecord[];
  /** Row currently mid-install/uninstall, so its toggle can show a spinner. */
  busyKey: string | null;
  installedRef: (source: string, name: string) => SkillRef | undefined;
  toggle: (skill: Skill) => Promise<void>;
  /** Add a GitHub Skill Source; returns it (and lists its skills) or null. */
  createSource: (input: {
    name: string;
    gitUrl: string;
    path?: string;
  }) => Promise<SkillSource | null>;
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
    /** Mirrors the installed set to the nav summary's query cache. Stable. */
    onInstalledChange?: (installed: SkillRef[]) => void;
  },
): SkillsSurface {
  const { readOnly, isError, onInstalledChange } = opts;

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
    Record<string, string | null>
  >({});
  const [installed, setInstalled] = useState<SkillRef[]>([]);
  const [standalone, setStandalone] = useState<LocalSkill[]>([]);
  const [publishes, setPublishes] = useState<SkillPublishRecord[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    onInstalledChange?.(installed);
  }, [installed, onInstalledChange]);

  const loadSkills = useCallback(
    async (sourceId: string) => {
      // Public GitHub sources scan from the api-server (no running agent
      // needed); private sources delegate to the pod and surface a
      // PRECONDITION_FAILED, rendered as a per-source error.
      if (!agentId) return;
      setLoadingBySource((l) => ({ ...l, [sourceId]: true }));
      setErrorBySource((e) => ({ ...e, [sourceId]: null }));
      try {
        const list = await api.skills.list.query({ sourceId, agentId });
        setSkillsBySource((s) => ({ ...s, [sourceId]: list }));
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to load skills";
        setErrorBySource((e) => ({ ...e, [sourceId]: msg }));
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

  return {
    sources,
    sourcesLoaded,
    stateLoaded,
    skillsBySource,
    loadingBySource,
    errorBySource,
    installed,
    standalone,
    publishes,
    busyKey,
    installedRef,
    toggle,
    createSource,
    removeSource,
    refreshSource,
  };
}
