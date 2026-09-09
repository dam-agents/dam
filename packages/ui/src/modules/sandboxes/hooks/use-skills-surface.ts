import { useQueries, useQuery } from "@tanstack/react-query";
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
import { useCallback, useState } from "react";

import { getErrorMessage } from "@/lib/errors";
import { toScanFailure } from "@/lib/scan-failure";

import { api } from "../../../api.js";
import { parsePlatformCta } from "../../../lib/platform-cta.js";
import { ACTION_FAILED, runAction } from "../../../lib/query-helpers.js";
import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useSkillSources, useSkillsState } from "../../agents/api/skills.js";
import { saveSkillFiles } from "../lib/skill-download.js";

const SCAN_STALE_MS = 60_000;
const SCAN_GC_MS = 24 * 60 * 60_000;
const STATE_POLL_MS = 5_000;

const NO_SOURCES: SkillSource[] = [];
const NO_SETS: SkillSet[] = [];
const NO_REFS: SkillRef[] = [];
const NO_LOCAL: LocalSkill[] = [];
const NO_PUBLISHES: SkillPublishRecord[] = [];

function scanInput(sourceId: string, agentId: string | null) {
  return agentId ? { sourceId, agentId } : { sourceId };
}

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
  revalidatingBySource: Record<string, boolean>;
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
  },
): SkillsSurface {
  const { readOnly, isError } = opts;

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [busySourceId, setBusySourceId] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [applyingSets, setApplyingSets] = useState(false);

  const sourcesQuery = useSkillSources(agentId);
  const sources = sourcesQuery.data ?? NO_SOURCES;
  const sourcesLoaded = agentId === null || !sourcesQuery.isPending;

  const scans = useQueries({
    queries: sources.map((src) => ({
      ...trpc.skills.listWithScan.queryOptions(scanInput(src.id, agentId)),
      retry: false,
      staleTime: SCAN_STALE_MS,
      gcTime: SCAN_GC_MS,
      refetchOnWindowFocus: false,
    })),
    combine: (results) => {
      const skillsBySource: Record<string, Skill[]> = {};
      const loadingBySource: Record<string, boolean> = {};
      const revalidatingBySource: Record<string, boolean> = {};
      const errorBySource: Record<string, ScanFailure | null> = {};
      const scannedAtBySource: Record<string, string> = {};
      const visibilityBySource: Record<string, "public" | "private"> = {};
      results.forEach((result, index) => {
        const src = sources[index];
        if (!src) return;
        const painted = result.data !== undefined;
        loadingBySource[src.id] = result.isFetching && !painted;
        revalidatingBySource[src.id] = result.isFetching && painted;
        if (result.isError) errorBySource[src.id] = toScanFailure(result.error);
        if (!result.data) return;
        skillsBySource[src.id] = result.data.skills;
        scannedAtBySource[src.id] = result.data.scannedAt;
        if (result.data.visibility) {
          visibilityBySource[src.id] = result.data.visibility;
        }
      });
      return {
        skillsBySource,
        loadingBySource,
        revalidatingBySource,
        errorBySource,
        scannedAtBySource,
        visibilityBySource,
      };
    },
  });

  const stateQuery = useSkillsState(agentId, { pollMs: STATE_POLL_MS });
  const stateLoaded = agentId === null || !stateQuery.isPending;
  const installed = stateQuery.data?.installed ?? NO_REFS;
  const standalone = stateQuery.data?.standalone ?? NO_LOCAL;
  const publishes = stateQuery.data?.instancePublishes ?? NO_PUBLISHES;
  const standaloneSnapshot = stateQuery.data?.standaloneSnapshot;

  const setsQuery = useQuery({
    ...trpc.skills.sets.list.queryOptions(),
    retry: false,
    staleTime: SCAN_STALE_MS,
    gcTime: SCAN_GC_MS,
  });
  const sets = setsQuery.data ?? NO_SETS;

  const patchState = useCallback(
    async (patch: (prev: SkillsState) => SkillsState) => {
      if (!agentId) return;
      const key = trpc.skills.state.queryKey({ agentId });
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData(key);
      if (!prev) {
        void queryClient.refetchQueries({ queryKey: key });
        return;
      }
      queryClient.setQueryData(key, patch(prev));
    },
    [agentId],
  );

  const commitInstalled = useCallback(
    (next: SkillRef[]) => patchState((prev) => ({ ...prev, installed: next })),
    [patchState],
  );

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
      if (result !== ACTION_FAILED) await commitInstalled(result);
      setBusyKey(null);
    },
    [agentId, isError, readOnly, installedRef, commitInstalled],
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
      if (result !== ACTION_FAILED) await commitInstalled(result);
      setBusyKey(null);
      return result !== ACTION_FAILED;
    },
    [agentId, isError, readOnly, commitInstalled],
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
      if (result !== ACTION_FAILED) await commitInstalled(result);
      setBusySourceId(null);
    },
    [agentId, isError, readOnly, installedRef, commitInstalled],
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
      if (result !== ACTION_FAILED) await commitInstalled(result);
      setUpdatingAll(false);
    },
    [agentId, isError, readOnly, commitInstalled],
  );

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
      queryClient.setQueryData(trpc.skills.sets.list.queryKey(), (prev) =>
        [...(prev ?? []), result].sort((a, b) => a.name.localeCompare(b.name)),
      );
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
    queryClient.setQueryData(trpc.skills.sets.list.queryKey(), (prev) =>
      (prev ?? []).filter((s) => s.id !== id),
    );
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
      await commitInstalled(result.installed);

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
    [agentId, isError, readOnly, commitInstalled],
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
      if (agentId) {
        queryClient.setQueryData(
          trpc.skills.sources.list.queryKey({ agentId }),
          (prev) => [...(prev ?? []), result],
        );
      }
      void queryClient.invalidateQueries(trpc.skills.sources.list.pathFilter());
      return result;
    },
    [agentId],
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
        await patchState((prev) => {
          const byName = new Map(prev.standalone.map((s) => [s.name, s]));
          for (const s of created) byName.set(s.name, s);
          return { ...prev, standalone: [...byName.values()] };
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
    [agentId, patchState],
  );

  const deleteStandalone = useCallback(
    async (skill: LocalSkill) => {
      if (!agentId) return false;
      const result = await runAction(
        () => api.skills.deleteLocal.mutate({ agentId, name: skill.name }),
        `Failed to delete ${skill.name}`,
      );
      if (result === ACTION_FAILED) return false;
      await patchState((prev) => ({ ...prev, standalone: result }));
      emitToast({ kind: "success", message: `Deleted ${skill.name}` });
      return true;
    },
    [agentId, patchState],
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

  const removeSource = useCallback(
    async (id: string) => {
      const result = await runAction(
        () => api.skills.sources.delete.mutate({ id }),
        "Failed to remove source",
      );
      if (result === ACTION_FAILED) return false;
      if (agentId) {
        queryClient.setQueryData(
          trpc.skills.sources.list.queryKey({ agentId }),
          (prev) => (prev ?? []).filter((s) => s.id !== id),
        );
      }
      queryClient.removeQueries({
        queryKey: trpc.skills.listWithScan.queryKey(scanInput(id, agentId)),
      });
      void queryClient.invalidateQueries(trpc.skills.sources.list.pathFilter());
      return true;
    },
    [agentId],
  );

  const refreshSource = useCallback(
    async (id: string) => {
      const ok = await runAction(
        () => api.skills.sources.refresh.mutate({ id }),
        "Failed to re-scan source",
      );
      if (ok === ACTION_FAILED) return;
      await queryClient.invalidateQueries({
        queryKey: trpc.skills.listWithScan.queryKey(scanInput(id, agentId)),
      });
    },
    [agentId],
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
        await patchState((prev) => ({
          ...prev,
          instancePublishes: [
            ...prev.instancePublishes,
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
          ],
        }));
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
    [agentId, sources, refreshSource, patchState],
  );

  return {
    sources,
    sourcesLoaded,
    stateLoaded,
    skillsBySource: scans.skillsBySource,
    loadingBySource: scans.loadingBySource,
    revalidatingBySource: scans.revalidatingBySource,
    errorBySource: scans.errorBySource,
    scannedAtBySource: scans.scannedAtBySource,
    visibilityBySource: scans.visibilityBySource,
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
    setsFailed: setsQuery.isError,
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
