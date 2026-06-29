import { SKILL_SOURCE_ROOTS } from "agent-runtime-api";
import type {
  LocalSkill,
  Skill,
  SkillPublishRecord,
  SkillRef,
  SkillSource,
} from "api-server-api";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  Info,
  Plus,
  RefreshCw,
  Share2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip } from "@/components/ui/tooltip";

import { api } from "../../../api.js";
import { ACTION_FAILED, runAction } from "../../../lib/query-helpers.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { AgentState } from "../../../types.js";

/** localStorage key for per-user persistence of collapsed source ids. Per
 *  browser, not per instance — catalog preferences apply everywhere. */
const COLLAPSED_STORAGE_KEY = "platform:skills:collapsed";

const collapsedStorageSchema = z.array(z.string());

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = collapsedStorageSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.warn(
        "[skills-panel] schema mismatch on collapsed-skills, resetting:",
        parsed.error.issues,
      );
      return new Set();
    }
    return new Set(parsed.data);
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Quota / private-mode / disabled storage — collapse still works for the
    // current session, just won't persist. Not worth surfacing to the user.
  }
}

/** True when a source should default to collapsed on first-ever visit —
 *  i.e. before the user has toggled anything. Admin-curated rows (Platform
 *  + Agent) start closed so a 50-skill catalog doesn't wall off the panel
 *  for a user who only cares about their own skills. */
function isCuratedSource(src: SkillSource): boolean {
  return !!src.system || !!src.fromTemplate;
}

interface SkillsPanelProps {
  agentId: string | null;
  agentState: AgentState | undefined;
  /** Opens a file in the Files tab. Threaded from useFileTree via ChatView. */
  onOpenFile?: (path: string) => void;
}

const skillKey = (source: string, name: string) => `${source}::${name}`;

function localSkillMdPath(skill: LocalSkill): string {
  const base = skill.skillPath.endsWith("/")
    ? skill.skillPath
    : `${skill.skillPath}/`;
  return `${base}${skill.name}/SKILL.md`;
}

/**
 * URL to open alongside a skill row. When the caller has confirmed drift
 * (via contentHash comparison), pass `compareFrom` so we open a GitHub
 * compare view between installed and latest — the concrete diff. Otherwise
 * open the skill's SKILL.md at the pinned commit.
 *
 * Must NOT re-derive drift from version equality here: scan returns a
 * uniform HEAD SHA for every skill in a source, so the versions can differ
 * even when this specific skill's files haven't changed (a commit that
 * touched a neighbour). The callsite's contentHash check is the source of
 * truth; we only shape the URL from it.
 */
function skillSourceUrl(
  source: string,
  version: string,
  name: string,
  path?: string,
  compareFrom?: string,
): string {
  const base = source.replace(/\.git$/, "").replace(/\/$/, "");
  const isGitLike =
    /^(?:https?:\/\/)?(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org)(?::\d+)?(?:\/|$)/.test(
      base,
    );
  if (!isGitLike) return base;
  if (compareFrom) {
    return `${base}/compare/${compareFrom}...${version}`;
  }
  const dir = path ?? "skills";
  return `${base}/blob/${version}/${dir}/${name}/SKILL.md`;
}

export function SkillsPanel({
  agentId,
  agentState,
  onOpenFile,
}: SkillsPanelProps) {
  const showConfirm = useStore((s) => s.showConfirm);

  const isError = agentState === "error";
  const isAsleep = !!agentId && agentState !== "running" && !isError;

  const [sources, setSources] = useState<SkillSource[]>([]);
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
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([]);
  const [publishes, setPublishes] = useState<SkillPublishRecord[]>([]);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", gitUrl: "", path: "" });
  const [addBusy, setAddBusy] = useState(false);
  const [publishFor, setPublishFor] = useState<LocalSkill | null>(null);
  const [publishForm, setPublishForm] = useState({
    sourceId: "",
    title: "",
    body: "",
  });
  const [publishBusy, setPublishBusy] = useState(false);

  /**
   * Ids whose collapse state is *inverted from the kind-level default*:
   *   - curated (Platform/Agent) ids in the set → user opted in to expand
   *   - user ids in the set → user collapsed their own row
   * This keeps the persisted value minimal and means brand-new sources
   * automatically honour the right default without pre-seeding storage.
   */
  const [collapseOverrides, setCollapseOverrides] =
    useState<Set<string>>(loadCollapsed);

  const isCollapsed = useCallback(
    (src: SkillSource): boolean => {
      const defaultCollapsed = isCuratedSource(src);
      return collapseOverrides.has(src.id)
        ? !defaultCollapsed
        : defaultCollapsed;
    },
    [collapseOverrides],
  );

  const toggleCollapsed = useCallback((id: string) => {
    setCollapseOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });
  }, []);

  const loadSkills = useCallback(
    async (sourceId: string) => {
      // Public GitHub sources are scanned directly from the api-server, so no
      // running agent is required. Private sources need the agent pod to
      // delegate to — the server surfaces a PRECONDITION_FAILED in that case
      // and we render it the same way any other per-source error renders.
      if (!agentId) return;
      setLoadingBySource((l) => ({ ...l, [sourceId]: true }));
      setErrorBySource((e) => ({ ...e, [sourceId]: null }));
      try {
        const list = await api.skills.list.query({
          sourceId,
          agentId,
        });
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

  const refreshSource = useCallback(
    async (sourceId: string) => {
      const ok = await runAction(
        () => api.skills.sources.refresh.mutate({ id: sourceId }),
        "Failed to refresh source",
      );
      if (ok !== ACTION_FAILED) await loadSkills(sourceId);
    },
    [loadSkills],
  );

  useEffect(() => {
    let cancelled = false;

    // Pulling both "installed" (tracked in spec.skills) and "standalone"
    // (on-disk only) from the same reconciled endpoint keeps them
    // consistent. The server cross-references spec.skills with the live
    // filesystem, drops ghost SkillRefs (entries whose directories were
    // deleted out-of-band), and persists the cleanup — so manual file
    // deletions stop showing as "installed" the moment the panel polls.
    const refreshInstalled = async () => {
      if (!agentId) {
        if (!cancelled) {
          setInstalled([]);
          setLocalSkills([]);
          setPublishes([]);
        }
        return;
      }
      try {
        const state = await api.skills.state.query({ agentId });
        if (!cancelled) {
          setInstalled(state.installed);
          setLocalSkills(state.standalone);
          setPublishes(state.instancePublishes);
        }
      } catch {}
    };

    (async () => {
      try {
        // Pass agentId so the backend composes user + platform + agent
        // (template-seeded) sources into a single ordered list.
        const srcs = await api.skills.sources.list.query(
          agentId ? { agentId } : undefined,
        );
        if (!cancelled) setSources(srcs);
      } catch {
        if (!cancelled) setSources([]);
      }
    })();
    refreshInstalled();

    // Poll so agent-initiated installs (via MCP tool calls in chat) show up
    // without a manual refresh. Matches SchedulesPanel's cadence.
    const iv = setInterval(refreshInstalled, 5000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [agentId]);

  useEffect(() => {
    // Only fetch for expanded sources. A collapsed row is invisible, so
    // scanning GitHub (or worse, delegating through agent-runtime for a
    // private repo) would be pure wasted bandwidth. When the user expands
    // a not-yet-loaded source, this effect re-runs on the state change
    // and loads it lazily.
    for (const src of sources) {
      if (isCollapsed(src)) continue;
      if (skillsBySource[src.id] === undefined && !loadingBySource[src.id]) {
        loadSkills(src.id);
      }
    }
  }, [sources, skillsBySource, loadingBySource, loadSkills, isCollapsed]);

  const isInstalled = (source: string, name: string) =>
    installed.some((s) => s.source === source && s.name === name);

  const installedRef = (source: string, name: string) =>
    installed.find((s) => s.source === source && s.name === name);

  const toggle = async (skill: Skill) => {
    if (!agentId || isError) return;
    const key = skillKey(skill.source, skill.name);
    setBusyRow(key);
    const currentlyInstalled = isInstalled(skill.source, skill.name);
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
    setBusyRow(null);
  };

  const updateDrift = async (skill: Skill) => {
    if (!agentId || isError) return;
    const key = skillKey(skill.source, skill.name);
    setBusyRow(key);
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
    setBusyRow(null);
  };

  const addSource = async () => {
    if (!addForm.name.trim() || !addForm.gitUrl.trim()) return;
    setAddBusy(true);
    const result = await runAction(
      () =>
        api.skills.sources.create.mutate({
          name: addForm.name.trim(),
          gitUrl: addForm.gitUrl.trim(),
          path: addForm.path.trim() || undefined,
        }),
      "Failed to add source",
    );
    setAddBusy(false);
    if (result !== ACTION_FAILED) {
      setSources((s) => [...s, result]);
      setAddForm({ name: "", gitUrl: "", path: "" });
      setShowAdd(false);
    }
  };

  const publishableSources = sources.filter((s) => s.canPublish);

  /** Latest publish record per skill name. Drives the "Published" badge +
   *  View-PR link. Name-match would have false-positived on installed
   *  skills that happen to collide with catalog names, so we rely on
   *  the explicit server-side publish log instead. */
  const latestPublishByName = new Map<string, SkillPublishRecord>();
  for (const p of publishes) {
    const current = latestPublishByName.get(p.skillName);
    if (!current || p.publishedAt > current.publishedAt) {
      latestPublishByName.set(p.skillName, p);
    }
  }

  const openPublish = (skill: LocalSkill) => {
    const first = publishableSources[0];
    if (!first) return;
    setPublishFor(skill);
    setPublishForm({
      sourceId: first.id,
      title: `Add ${skill.name} skill`,
      body: skill.description ?? "",
    });
  };

  const publish = async () => {
    if (!agentId || !publishFor) return;
    setPublishBusy(true);
    try {
      const result = await api.skills.publish.mutate({
        agentId,
        sourceId: publishForm.sourceId,
        name: publishFor.name,
        title: publishForm.title.trim() || undefined,
        body: publishForm.body.trim() || undefined,
      });
      emitToast({
        kind: "success",
        message: `Published ${publishFor.name}`,
        action: {
          label: "View PR",
          onClick: () => window.open(result.prUrl, "_blank"),
        },
        ttl: 10_000,
      });
      setPublishFor(null);
      // Drop the target source's scan cache + refetch so the skill appears
      // in the catalog as soon as the PR is merged (even if the user's
      // still sitting on this panel).
      void refreshSource(publishForm.sourceId);
    } catch (err) {
      // publish-service encodes a call-to-action URL as `\nplatform-cta:<url>`
      // in the error message when an upstream surfaces a structured error
      // (not connected / agent access not granted). Parse it out so the
      // toast's action button takes the user straight to the right fix.
      const rawMessage =
        err instanceof Error
          ? err.message
          : `Failed to publish ${publishFor.name}`;
      const cta = rawMessage.match(/platform-cta:(\S+)/)?.[1];
      const message = rawMessage.replace(/\nplatform-cta:\S+/, "").trim();
      emitToast({
        kind: "error",
        message,
        action: cta
          ? { label: "Fix it", onClick: () => window.open(cta, "_blank") }
          : undefined,
        ttl: 15_000,
      });
    } finally {
      setPublishBusy(false);
    }
  };

  const deleteSource = async (src: SkillSource) => {
    const ok = await showConfirm(
      `Remove source "${src.name}"? Installed skills stay on running agents.`,
      "Remove Source",
    );
    if (!ok) return;
    const result = await runAction(
      () => api.skills.sources.delete.mutate({ id: src.id }),
      "Failed to remove source",
    );
    if (result !== ACTION_FAILED) {
      setSources((s) => s.filter((x) => x.id !== src.id));
      setSkillsBySource((s) => {
        const next = { ...s };
        delete next[src.id];
        return next;
      });
    }
  };

  const inp =
    "w-full h-8 rounded-md border-2 border-border-light bg-surface px-3 text-[12px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]";

  return (
    <div className="flex flex-col">
      {isError && (
        <div className="px-4 py-2 border-b border-border-light text-[11px] text-text-muted bg-warning-light">
          Agent is in an error state — resolve it before managing skills.
        </div>
      )}
      {isAsleep && (
        <div className="px-4 py-2 border-b border-border-light text-[11px] text-text-muted">
          Asleep — installing or removing a skill will wake the agent; this can
          take a moment.
        </div>
      )}

      {localSkills.length > 0 && (
        <div className="border-b border-border-light">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-raised">
            <span className="text-[12px] font-bold text-text flex-1 truncate">
              Standalone
            </span>
          </div>
          {publishFor && (
            <div className="flex flex-col gap-3 border-b border-border-light p-4 anim-in bg-surface">
              <div className="text-[11px] text-text-muted">
                Publishing{" "}
                <span className="font-mono text-text">{publishFor.name}</span>{" "}
                as a pull request.
              </div>
              <select
                className={inp}
                value={publishForm.sourceId}
                onChange={(e) =>
                  setPublishForm((f) => ({ ...f, sourceId: e.target.value }))
                }
              >
                {publishableSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (
                    {s.gitUrl.replace(/^https:\/\/(github|gitlab)\.com\//, "")})
                  </option>
                ))}
              </select>
              <Input
                size="sm"
                placeholder="Pull request title"
                value={publishForm.title}
                onChange={(e) =>
                  setPublishForm((f) => ({ ...f, title: e.target.value }))
                }
              />
              <textarea
                className="w-full rounded-md border-2 border-border-light bg-surface px-3 py-2 text-[12px] text-text outline-none transition-all focus:border-accent resize-y min-h-[60px]"
                placeholder="Pull request body (optional)"
                value={publishForm.body}
                onChange={(e) =>
                  setPublishForm((f) => ({ ...f, body: e.target.value }))
                }
                rows={3}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setPublishFor(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="xs"
                  disabled={publishBusy || !publishForm.sourceId}
                  onClick={publish}
                >
                  {publishBusy ? "Publishing…" : "Publish"}
                </Button>
              </div>
            </div>
          )}

          {localSkills.map((skill) => (
            <div
              key={`${skill.skillPath}::${skill.name}`}
              className="flex items-start gap-3 border-b border-border-light last:border-b-0 px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-text truncate">
                    {skill.name}
                  </span>
                  {(() => {
                    const pub = latestPublishByName.get(skill.name);
                    if (!pub) return null;
                    return (
                      <a
                        href={pub.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 bg-success-light text-success border-success hover:opacity-80"
                        title={`Published to ${pub.sourceName} on ${new Date(pub.publishedAt).toLocaleString()} — click to view PR`}
                      >
                        Published <ExternalLink size={9} />
                      </a>
                    );
                  })()}
                  {onOpenFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0"
                      title="View SKILL.md in Files"
                      onClick={() => onOpenFile(localSkillMdPath(skill))}
                    >
                      <Eye size={11} />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0"
                    title={
                      publishableSources.length === 0
                        ? "Add a GitHub source first to publish there"
                        : "Publish this skill as a pull request"
                    }
                    disabled={publishableSources.length === 0}
                    onClick={() => openPublish(skill)}
                  >
                    <Share2 size={11} />
                  </Button>
                </div>
                {skill.description && (
                  <div
                    className="mt-0.5 text-[11px] text-text-muted line-clamp-2"
                    title={skill.description}
                  >
                    {skill.description}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="px-3 py-2.5 shrink-0">
        <Button
          variant="outline"
          size="xs"
          className="w-full"
          onClick={() => {
            setAddForm({ name: "", gitUrl: "", path: "" });
            setShowAdd(true);
          }}
        >
          <Plus size={12} /> Add Source
        </Button>
      </div>

      {showAdd && (
        <div className="flex flex-col gap-3 border-b border-border-light p-4 anim-in">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-text-muted">Name</Label>
            <Input
              size="sm"
              placeholder='e.g. "My Skills"'
              value={addForm.name}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, name: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-text-muted">Git URL</Label>
            <Input
              size="sm"
              variant="monospace"
              placeholder="https://github.com/your-org/skills"
              value={addForm.gitUrl}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, gitUrl: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label className="text-[11px] text-text-muted">
                Path (optional)
              </Label>
              <Tooltip
                side="right"
                content={
                  <span>
                    Subdirectory to scan for skills. Leave empty to
                    auto-discover skills in{" "}
                    {SKILL_SOURCE_ROOTS.map((r) => `${r}/`).join(", ")} or the
                    repo root.
                  </span>
                }
              >
                <Info
                  size={12}
                  className="text-text-muted cursor-help shrink-0"
                />
              </Tooltip>
            </div>
            <Input
              size="sm"
              variant="monospace"
              placeholder="e.g. packages/skills"
              value={addForm.path}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, path: e.target.value }))
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px]"
              disabled={
                addBusy || !addForm.name.trim() || !addForm.gitUrl.trim()
              }
              onClick={addSource}
            >
              {addBusy ? "..." : "Add"}
            </Button>
          </div>
        </div>
      )}

      {sources.length === 0 && !showAdd && (
        <p className="px-4 py-5 text-[12px] text-text-muted">
          No sources. Add a public git repo with skills.
        </p>
      )}

      {sources.map((src) => {
        const list = skillsBySource[src.id] ?? [];
        const loading = !!loadingBySource[src.id];
        const error = errorBySource[src.id];
        const collapsed = isCollapsed(src);
        return (
          <div key={src.id} className="border-b border-border-light">
            {/* Whole header is the click target for collapse/expand. Nested
                buttons (refresh, delete) stop propagation so they don't
                accidentally toggle the section. */}
            <button
              type="button"
              onClick={() => toggleCollapsed(src.id)}
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-surface-raised hover:bg-[var(--color-border-light)] transition-colors text-left"
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${src.name}`}
            >
              {collapsed ? (
                <ChevronRight size={14} className="text-text-muted shrink-0" />
              ) : (
                <ChevronDown size={14} className="text-text-muted shrink-0" />
              )}
              <span className="text-[12px] font-bold text-text flex-1 truncate">
                {src.name}
              </span>
              {src.system && (
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 bg-info-light text-info border-info"
                  title="Configured by the cluster admin, visible to every user"
                >
                  Platform
                </span>
              )}
              {src.fromTemplate && (
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 bg-template-light text-template border-template"
                  title={`Included with the ${src.fromTemplate.templateName} agent template`}
                >
                  Agent
                </span>
              )}
              <span
                className="text-[11px] text-text-muted truncate max-w-[200px]"
                title={src.path ? `${src.gitUrl} · ${src.path}` : src.gitUrl}
              >
                {src.gitUrl.replace(/^https:\/\/github\.com\//, "")}
                {src.path ? ` · ${src.path}` : ""}
              </span>
              <span
                role="button"
                tabIndex={0}
                className={`text-text-muted hover:text-accent transition-colors ${loading ? "anim-spin" : ""} ${loading ? "pointer-events-none opacity-50" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!loading) void refreshSource(src.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!loading) void refreshSource(src.id);
                  }
                }}
                title="Re-scan this source"
              >
                <RefreshCw size={12} />
              </span>
              {!src.system && !src.fromTemplate && (
                <span
                  role="button"
                  tabIndex={0}
                  className="text-text-muted hover:text-danger transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteSource(src);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      void deleteSource(src);
                    }
                  }}
                  title="Remove source"
                >
                  <X size={13} />
                </span>
              )}
            </button>

            {!collapsed && loading && (
              <div className="px-4 py-3 text-[11px] text-text-muted">
                Loading skills...
              </div>
            )}

            {!collapsed &&
              error &&
              (() => {
                // publish/scan services encode a call-to-action URL as
                // `\nplatform-cta:<url>` in the tRPC error message when an
                // upstream surfaces a structured error (not connected /
                // agent access not granted / repo not in OAuth App's
                // allowed list). Split it out so the banner offers a
                // direct link to the fix.
                const cta = error.match(/platform-cta:(\S+)/)?.[1];
                const message = error.replace(/\nplatform-cta:\S+/, "").trim();
                return (
                  <div className="px-4 py-2 text-[11px] text-danger bg-danger-light flex items-center gap-2">
                    <span className="flex-1">{message}</span>
                    {cta && (
                      <a
                        href={cta}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold underline hover:opacity-80 shrink-0"
                      >
                        Fix it →
                      </a>
                    )}
                  </div>
                );
              })()}

            {!collapsed && !loading && !error && list.length === 0 && (
              <p className="px-4 py-3 text-[11px] text-text-muted">
                No skills in this source.
              </p>
            )}

            {!collapsed &&
              list.map((skill) => {
                const installed = installedRef(skill.source, skill.name);
                const isInst = installed !== undefined;
                // Drift = contents changed. contentHash is missing only for
                // skills installed before this field existed — we skip drift
                // until the next install/update fills it in.
                const hasDrift =
                  isInst &&
                  installed.contentHash !== undefined &&
                  installed.contentHash !== skill.contentHash;
                const key = skillKey(skill.source, skill.name);
                const rowBusy = busyRow === key;
                const disabled = !agentId || isError || rowBusy;

                return (
                  <label
                    key={key}
                    className={`flex items-start gap-3 border-b border-border-light last:border-b-0 px-4 py-3 transition-colors ${isInst ? "bg-accent-light" : ""} ${disabled ? "opacity-60" : "cursor-pointer hover:bg-surface-raised"}`}
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--color-accent)] w-4 h-4 mt-0.5"
                      checked={isInst}
                      disabled={disabled}
                      onChange={() => toggle(skill)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-text truncate">
                          {skill.name}
                        </span>
                        <a
                          href={skillSourceUrl(
                            skill.source,
                            skill.version,
                            skill.name,
                            sources.find((s) => s.gitUrl === skill.source)
                              ?.path,
                            hasDrift ? installed?.version : undefined,
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-text-muted hover:text-accent transition-colors shrink-0"
                          title={
                            hasDrift
                              ? "View changes since installed version"
                              : "View SKILL.md at the pinned commit"
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={11} />
                        </a>
                        {hasDrift && (
                          <button
                            type="button"
                            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 bg-info-light text-info border-info hover:opacity-80 disabled:opacity-40"
                            title={`Skill contents changed since install (installed ${installed?.version.slice(0, 8)} → ${skill.version.slice(0, 8)})`}
                            disabled={disabled}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              updateDrift(skill);
                            }}
                          >
                            <RefreshCw size={10} /> Update
                          </button>
                        )}
                        {rowBusy && (
                          <span className="w-3 h-3 rounded-full border-2 border-border-light border-t-accent anim-spin shrink-0" />
                        )}
                      </div>
                      {skill.description && (
                        <div
                          className="mt-0.5 text-[11px] text-text-muted line-clamp-2"
                          title={skill.description}
                        >
                          {skill.description}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
