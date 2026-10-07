import type {
  ScanFailure,
  Skill,
  SkillRef,
  SkillSet,
  SkillSource,
} from "api-server-api";
import { skillKey } from "api-server-api";
import { useCallback, useEffect, useMemo, useState } from "react";

import { toScanFailure } from "@/lib/scan-failure";

import { api } from "../../../api.js";
import { ACTION_FAILED, runAction } from "../../../lib/query-helpers.js";
import { emitToast } from "../../../lib/toast.js";

export interface SkillsSetup {
  sources: SkillSource[];
  sourcesLoaded: boolean;
  skillsBySource: Record<string, Skill[]>;
  loadingBySource: Record<string, boolean>;
  errorBySource: Record<string, ScanFailure | null>;
  scannedAtBySource: Record<string, string>;

  selectedKeys: ReadonlySet<string>;
  installedRef: (source: string, name: string) => SkillRef | undefined;
  totalSelected: number;

  stagedLocalSkills: { name: string; content: string }[];
  removeLocalSkill: (name: string) => void;

  sets: SkillSet[];
  pendingSetIds: string[];

  toggle: (skill: Skill) => void;
  toggleSource: (sourceId: string, skills: Skill[], on: boolean) => void;
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
  removeSource: (id: string) => Promise<boolean>;
  refreshSource: (id: string) => Promise<void>;
  deleteSet: (id: string) => Promise<boolean>;
  setPendingSetIds: (ids: string[]) => void;

  applyToAgent: (agentId: string) => Promise<void>;
}

export function useSkillsSetup(): SkillsSetup {
  const [sources, setSources] = useState<SkillSource[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [sets, setSets] = useState<SkillSet[]>([]);
  const [pendingSetIds, setPendingSetIds] = useState<string[]>([]);
  const [stagedLocalSkills, setStagedLocalSkills] = useState<
    { name: string; content: string }[]
  >([]);

  const loadSkills = useCallback(
    async (sourceId: string, autoSelect = false) => {
      setLoadingBySource((l) => ({ ...l, [sourceId]: true }));
      setErrorBySource((e) => ({ ...e, [sourceId]: null }));
      try {
        const { skills, scannedAt } = await api.skills.listWithScan.query({
          sourceId,
        });
        setSkillsBySource((s) => ({ ...s, [sourceId]: skills }));
        setScannedAtBySource((m) => ({ ...m, [sourceId]: scannedAt }));
        if (autoSelect) {
          setSelectedKeys((prev) => {
            const next = new Set(prev);
            for (const s of skills) next.add(skillKey(s));
            return next;
          });
        }
      } catch (err) {
        setErrorBySource((e) => ({ ...e, [sourceId]: toScanFailure(err) }));
        setSkillsBySource((s) => ({ ...s, [sourceId]: [] }));
      } finally {
        setLoadingBySource((l) => ({ ...l, [sourceId]: false }));
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const srcs = await api.skills.sources.list.query();
        if (!cancelled) setSources(srcs);
      } catch {
        if (!cancelled) setSources([]);
      } finally {
        if (!cancelled) setSourcesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.skills.sets.list
      .query()
      .then((s) => {
        if (!cancelled) setSets(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    for (const src of sources) {
      if (skillsBySource[src.id] === undefined && !loadingBySource[src.id]) {
        loadSkills(src.id);
      }
    }
  }, [sources, skillsBySource, loadingBySource, loadSkills]);

  const skillLookup = useMemo(() => {
    const map = new Map<string, Skill>();
    for (const list of Object.values(skillsBySource)) {
      for (const skill of list) map.set(skillKey(skill), skill);
    }
    return map;
  }, [skillsBySource]);

  const installedRef = useCallback(
    (source: string, name: string): SkillRef | undefined => {
      const key = `${source}::${name}`;
      if (!selectedKeys.has(key)) return undefined;
      const skill = skillLookup.get(key);
      if (!skill) return undefined;
      return {
        source: skill.source,
        name: skill.name,
        version: skill.version,
        contentHash: skill.contentHash,
      };
    },
    [selectedKeys, skillLookup],
  );

  const toggle = useCallback((skill: Skill) => {
    const key = skillKey(skill);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSource = useCallback(
    (sourceId: string, skills: Skill[], on: boolean) => {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const s of skills) {
          const key = skillKey(s);
          if (on) next.add(key);
          else next.delete(key);
        }
        return next;
      });
    },
    [],
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
      void loadSkills(result.id, true);
      return result;
    },
    [loadSkills],
  );

  const removeSource = useCallback(
    async (id: string) => {
      const result = await runAction(
        () => api.skills.sources.delete.mutate({ id }),
        "Failed to remove source",
      );
      if (result === ACTION_FAILED) return false;
      setSources((s) => s.filter((x) => x.id !== id));
      const removedSkills = skillsBySource[id] ?? [];
      if (removedSkills.length > 0) {
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          for (const s of removedSkills) next.delete(skillKey(s));
          return next;
        });
      }
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
    },
    [skillsBySource],
  );

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

  const createLocalSkills = useCallback(
    async (
      skills: { name: string; content: string }[],
    ): Promise<
      { ok: true } | { ok: false; conflictNames: string[]; message: string }
    > => {
      const existingNames = new Set(stagedLocalSkills.map((s) => s.name));
      const conflictNames = skills
        .filter((s) => existingNames.has(s.name))
        .map((s) => s.name);
      if (conflictNames.length > 0) {
        return {
          ok: false,
          conflictNames,
          message: `Skills already added: ${conflictNames.join(", ")}`,
        };
      }
      setStagedLocalSkills((prev) => [...prev, ...skills]);
      emitToast({
        kind: "success",
        message: `Added ${skills.length} skill${skills.length === 1 ? "" : "s"}`,
      });
      return { ok: true };
    },
    [stagedLocalSkills],
  );

  const removeLocalSkill = useCallback((name: string) => {
    setStagedLocalSkills((prev) => prev.filter((s) => s.name !== name));
  }, []);

  const deleteSet = useCallback(async (id: string) => {
    const result = await runAction(
      () => api.skills.sets.delete.mutate({ id }),
      "Failed to delete skill set",
    );
    if (result === ACTION_FAILED) return false;
    setSets((prev) => prev.filter((s) => s.id !== id));
    setPendingSetIds((prev) => prev.filter((x) => x !== id));
    return true;
  }, []);

  const applyToAgent = useCallback(
    async (agentId: string) => {
      const toInstall = [...selectedKeys]
        .map((key) => skillLookup.get(key))
        .filter((s): s is Skill => s !== undefined);

      if (toInstall.length > 0) {
        await runAction(
          () =>
            api.skills.applyBatch.mutate({
              agentId,
              install: toInstall.map((s) => ({
                source: s.source,
                name: s.name,
                version: s.version,
                contentHash: s.contentHash,
              })),
              uninstall: [],
            }),
          "Failed to install skills",
        );
      }

      if (stagedLocalSkills.length > 0) {
        await runAction(
          () =>
            api.skills.createLocal.mutate({
              agentId,
              skills: stagedLocalSkills,
            }),
          "Failed to add uploaded skills",
        );
      }

      if (pendingSetIds.length > 0) {
        const result = await runAction(
          () =>
            api.skills.sets.applyToAgent.mutate({
              agentId,
              setIds: pendingSetIds,
            }),
          "Failed to apply skill sets",
        );
        if (result !== ACTION_FAILED && result.added > 0) {
          emitToast({
            kind: "success",
            message: `Applied ${result.added} skill${result.added === 1 ? "" : "s"} from sets`,
          });
        }
      }
    },
    [selectedKeys, skillLookup, stagedLocalSkills, pendingSetIds],
  );

  return {
    sources,
    sourcesLoaded,
    skillsBySource,
    loadingBySource,
    errorBySource,
    scannedAtBySource,
    selectedKeys,
    installedRef,
    totalSelected: selectedKeys.size,
    stagedLocalSkills,
    removeLocalSkill,
    sets,
    pendingSetIds,
    toggle,
    toggleSource,
    createSource,
    createLocalSkills,
    removeSource,
    refreshSource,
    deleteSet,
    setPendingSetIds,
    applyToAgent,
  };
}
