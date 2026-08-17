import { randomUUID } from "node:crypto";
import { emit, EventType } from "../../../events.js";
import { TRPCError } from "@trpc/server";
import {
  CUSTOM_DATA_MAX_BYTES,
  experimentFolderName,
  type Agent,
  type Experiment,
  type ExperimentDriverSummary,
  type ExperimentSandboxCreateInput,
  type ExperimentSpan,
  type ExperimentsService,
  type FinishInput,
  type PlanRegisterInput,
  type TraceEvent,
  type TraceFeed,
  type TraceFeedInvocation,
} from "api-server-api";
import type { ArtifactLibraryServiceImpl } from "../../artifact-library/index.js";
import { projectFeed } from "../domain/trace-graph.js";
import { canTransition } from "../domain/lifecycle.js";
import { buildLaunchPrompt } from "../domain/launch-prompt.js";
import {
  hasFeedSnapshot,
  injectFeedSnapshot,
} from "../domain/feed-snapshot.js";
import { STOCK_DASHBOARD_HTML } from "../domain/stock-dashboard.js";
import type {
  ExperimentRow,
  ExperimentsRepository,
  SpanRow,
} from "../infrastructure/experiments-repository.js";

export class DraftAttachError extends Error {
  constructor() {
    super(
      "this experiment is a draft — start a run before attaching artifacts",
    );
    this.name = "DraftAttachError";
  }
}

export class UnknownExperimentError extends Error {
  constructor() {
    super("unknown experiment");
    this.name = "UnknownExperimentError";
  }
}

export class ExperimentClosedError extends Error {
  constructor(status: string) {
    super(`experiment is ${status}; the trace is closed`);
    this.name = "ExperimentClosedError";
  }
}

export class ScriptContentRequiredError extends Error {
  constructor() {
    super(
      "script sha changed but no scriptContent was provided; send the full source with run-start",
    );
    this.name = "ScriptContentRequiredError";
  }
}

export class CustomDataTooLargeError extends Error {
  constructor(bytes: number) {
    super(
      `custom data would be ${bytes} bytes serialized; the cap is ${CUSTOM_DATA_MAX_BYTES}`,
    );
    this.name = "CustomDataTooLargeError";
  }
}

export interface ExperimentsServiceDeps {
  owner: string;
  surface: string;
  repo: ExperimentsRepository;
  artifactLibrary: ArtifactLibraryServiceImpl;
  invocationsForExperiment: (
    driverAgentId: string,
    experimentId: string,
  ) => Promise<TraceFeedInvocation[]>;
  runningInvocationsByDriver: () => Promise<Map<string, number>>;
  experimentForInvocation?: (targetAgentId: string) => Promise<string | null>;
  snapshotDashboard?: (experimentId: string, owner: string) => Promise<void>;
  cancelInvocations?: (
    driverAgentId: string,
    experimentId: string,
  ) => Promise<void>;
  pin?: {
    set(driverAgentId: string): Promise<void>;
    clear(driverAgentId: string): Promise<void>;
  };
  launcher?: {
    launch(input: {
      agentId: string;
      experimentId: string;
      task: string;
    }): Promise<void>;
  };
  createSandbox?: (input: ExperimentSandboxCreateInput) => Promise<Agent>;
  now?: () => Date;
}

export function toView(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    owner: row.owner,
    driverAgentId: row.driverAgentId,
    name: row.name,
    status: row.status,
    skeleton: row.skeleton,
    drift: row.drift,
    scriptPath: row.scriptPath,
    scriptSha256: row.scriptSha256,
    scriptArtifactId: row.scriptArtifactId,
    scriptVersion: row.scriptVersion,
    dashboardArtifactId: row.dashboardArtifactId,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    executedAt: row.executedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
  };
}

export function toSpanView(row: SpanRow): ExperimentSpan {
  return {
    spanId: row.spanId,
    stage: row.stage,
    iteration: row.iteration,
    parentSpanId: row.parentSpanId,
    status: row.status,
    score: row.score,
    artifactIds: row.artifactIds,
    attrs: row.attrs,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

function scriptFileName(scriptPath: string): string {
  const base = scriptPath.split("/").at(-1);
  return base && base.length > 0 ? base : "experiment.py";
}

export function createExperimentsService(
  deps: ExperimentsServiceDeps,
): ExperimentsService {
  const { owner, repo, artifactLibrary } = deps;

  const emitChanged = (
    experimentId: string,
    agentId: string,
    action?: "started" | "stopped" | "deleted",
  ) =>
    emit({
      type: EventType.ExperimentChanged,
      experimentId,
      agentId,
      ownerSub: owner,
      ...(action ? { action, actorSub: owner, surface: deps.surface } : {}),
    });
  const now = deps.now ?? (() => new Date());

  async function lineageFolderId(name: string): Promise<string> {
    const folderName = experimentFolderName(name);
    const existing = (await artifactLibrary.listFolders()).find(
      (folder) => folder.name === folderName,
    );
    if (existing) return existing.id;
    return (await artifactLibrary.createFolder(folderName)).id;
  }

  async function snapshotDashboard(experimentId: string): Promise<void> {
    if (!deps.snapshotDashboard) return;
    try {
      await deps.snapshotDashboard(experimentId, owner);
    } catch (err) {
      process.stderr.write(
        `[experiments] dashboard snapshot for ${experimentId} failed: ${err instanceof Error ? err.message : err}\n`,
      );
    }
  }

  async function releasePin(driverAgentId: string): Promise<void> {
    if (!deps.pin) return;
    try {
      if (!(await repo.hasRunningForDriver(driverAgentId))) {
        await deps.pin.clear(driverAgentId);
      }
    } catch (err) {
      process.stderr.write(
        `[experiments] pin clear for ${driverAgentId} failed: ${err instanceof Error ? err.message : err}\n`,
      );
    }
  }

  async function launchRun(id: string): Promise<Experiment> {
    const row = await repo.get(id, owner);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    await deps.pin?.set(row.driverAgentId);
    try {
      await deps.launcher!.launch({
        agentId: row.driverAgentId,
        experimentId: id,
        task: buildLaunchPrompt({
          name: row.name,
          experimentId: id,
          scriptPath: row.scriptPath,
        }),
      });
    } catch (err) {
      await repo.transition(id, "running", "failed", {
        finishedAt: now(),
        error: `launch failed: ${err instanceof Error ? err.message : err}`,
      });
      emitChanged(id, row.driverAgentId);
      await releasePin(row.driverAgentId);
      await snapshotDashboard(id);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "the experiment could not be launched",
      });
    }
    emitChanged(id, row.driverAgentId);
    return toView((await repo.get(id, owner))!);
  }

  async function requireDriverExperiment(
    driverAgentId: string,
    experimentId: string,
  ): Promise<ExperimentRow> {
    const experiment = await repo.get(experimentId, owner);
    if (!experiment || experiment.driverAgentId !== driverAgentId) {
      throw new UnknownExperimentError();
    }
    return experiment;
  }

  return {
    async createSandbox(input: ExperimentSandboxCreateInput) {
      if (!deps.createSandbox) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "creating experiment sandboxes is not wired on this surface",
        });
      }
      return deps.createSandbox(input);
    },

    async list() {
      return (await repo.list(owner)).map(toView);
    },

    async driverSummaries() {
      const [experiments, running] = await Promise.all([
        repo.list(owner),
        deps.runningInvocationsByDriver(),
      ]);
      const byDriver = new Map<string, ExperimentDriverSummary>();
      for (const row of experiments) {
        let summary = byDriver.get(row.driverAgentId);
        if (!summary) {
          summary = {
            driverAgentId: row.driverAgentId,
            experiments: [],
            runningInvocations: running.get(row.driverAgentId) ?? 0,
          };
          byDriver.set(row.driverAgentId, summary);
        }
        summary.experiments.push({
          id: row.id,
          name: row.name,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
        });
      }
      return [...byDriver.values()];
    },

    async get(id) {
      const row = await repo.get(id, owner);
      return row ? toView(row) : null;
    },

    async feed(id) {
      const row = await repo.get(id, owner);
      if (!row) return null;
      const [spans, invocations] = await Promise.all([
        repo.listSpans(id),
        deps.invocationsForExperiment(row.driverAgentId, id),
      ]);
      return projectFeed({
        experiment: toView(row),
        spans: spans.map(toSpanView),
        invocations,
        custom: row.customData,
        attachedArtifactIds: row.attachedArtifactIds,
      }) satisfies TraceFeed;
    },

    async startRun(id) {
      const row = await repo.get(id, owner);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.status === "running") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "this run is still going; stop it or wait for it to finish",
        });
      }
      if (!deps.launcher) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "starting runs is not wired on this surface",
        });
      }
      const source =
        row.status === "draft"
          ? row
          : ((await repo.getDraft(row.driverAgentId, row.name)) ?? row);
      const runNumber =
        (await repo.countRuns(source.driverAgentId, source.name)) + 1;

      const cloneArtifact = async (
        artifactId: string,
        title: string,
        folderId?: string,
      ): Promise<string | null> => {
        try {
          const current = await artifactLibrary.getContent(artifactId);
          if (!current || current.binary || current.tooLarge) return null;
          const clone = await artifactLibrary.create(
            {
              title,
              content: current.content,
              fileName: current.fileName,
              kind: current.kind,
              ...(folderId ? { folderId } : {}),
            },
            { agentId: source.driverAgentId, internal: true },
          );
          return clone.id;
        } catch {
          return null;
        }
      };

      const runId = randomUUID();
      const runFolderId = await lineageFolderId(source.name).catch(
        () => undefined,
      );
      const scriptCloneId = await cloneArtifact(
        source.scriptArtifactId,
        `${source.name} — run ${runNumber} script`,
        runFolderId,
      );

      await repo.insert({
        id: runId,
        owner,
        driverAgentId: source.driverAgentId,
        name: source.name,
        skeleton: source.skeleton,
        scriptPath: source.scriptPath,
        scriptSha256: source.scriptSha256,
        scriptArtifactId: scriptCloneId ?? source.scriptArtifactId,
        scriptVersion: scriptCloneId ? 1 : source.scriptVersion,
        dashboardArtifactId: source.dashboardArtifactId,
        status: "running",
        executedAt: now(),
        lastActivityAt: now(),
      });
      const launched = await launchRun(runId);
      emitChanged(runId, source.driverAgentId, "started");
      return launched;
    },

    async stop(id) {
      const row = await repo.get(id, owner);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const flipped = await repo.transition(id, "running", "stopped", {
        finishedAt: now(),
      });
      if (!flipped) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "only a running experiment can be stopped",
        });
      }
      try {
        await deps.cancelInvocations?.(row.driverAgentId, id);
      } catch (err) {
        process.stderr.write(
          `[experiments] invocation cancel for ${id} failed: ${err instanceof Error ? err.message : err}\n`,
        );
      }
      emitChanged(id, row.driverAgentId, "stopped");
      await releasePin(row.driverAgentId);
      await snapshotDashboard(id);
      return toView((await repo.get(id, owner))!);
    },

    async delete(id) {
      const row = await repo.get(id, owner);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.status === "running") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "stop the experiment before deleting it",
        });
      }
      await repo.delete(id, owner);
      emitChanged(id, row.driverAgentId, "deleted");
    },

    async planRegister(driverAgentId, input: PlanRegisterInput) {
      const fileName = scriptFileName(input.script.path);

      const captureDashboard = async (
        existingId: string | null,
      ): Promise<string | null> => {
        if (!input.dashboard) return existingId;
        if (existingId) {
          try {
            await artifactLibrary.update(existingId, {
              content: input.dashboard.content,
              fileName: "dashboard.html",
            });
            return existingId;
          } catch {}
        }
        const captureFolderId = await lineageFolderId(input.name).catch(
          () => undefined,
        );
        const dashboard = await artifactLibrary.create(
          {
            title: `${input.name} — dashboard`,
            content: input.dashboard.content,
            fileName: "dashboard.html",
            kind: "html",
            ...(captureFolderId ? { folderId: captureFolderId } : {}),
          },
          { agentId: driverAgentId, internal: true },
        );
        return dashboard.id;
      };

      const draft = await repo.getDraft(driverAgentId, input.name);
      if (draft) {
        let version = draft.scriptVersion;
        if (draft.scriptSha256 !== input.script.sha256) {
          const updated = await artifactLibrary.update(draft.scriptArtifactId, {
            content: input.script.content,
            fileName,
          });
          version = updated.version;
        }
        const dashboardArtifactId =
          (await captureDashboard(draft.dashboardArtifactId)) ??
          draft.dashboardArtifactId;
        if (!input.dashboard && dashboardArtifactId) {
          try {
            const stored =
              await artifactLibrary.getContent(dashboardArtifactId);
            if (
              stored &&
              !stored.binary &&
              !stored.tooLarge &&
              hasFeedSnapshot(stored.content)
            ) {
              const draftFeed = projectFeed({
                experiment: {
                  ...toView(draft),
                  skeleton: input.skeleton,
                  scriptPath: input.script.path,
                  scriptSha256: input.script.sha256,
                  scriptVersion: version,
                },
                spans: [],
                invocations: [],
              });
              const fresh = injectFeedSnapshot(STOCK_DASHBOARD_HTML, draftFeed);
              if (fresh !== stored.content) {
                await artifactLibrary.update(dashboardArtifactId, {
                  content: fresh,
                  fileName: "dashboard.html",
                });
              }
            }
          } catch {}
        }
        await repo.updateDraft(draft.id, {
          skeleton: input.skeleton,
          scriptPath: input.script.path,
          scriptSha256: input.script.sha256,
          scriptVersion: version,
          dashboardArtifactId,
        });
        emitChanged(draft.id, driverAgentId);
        return { experimentId: draft.id };
      }

      const folderId = await lineageFolderId(input.name);
      const scriptArtifact = await artifactLibrary.create(
        {
          title: `${input.name} — script`,
          content: input.script.content,
          fileName,
          folderId,
        },
        { agentId: driverAgentId, internal: true },
      );
      const scriptArtifactId = scriptArtifact.id;
      const scriptVersion = scriptArtifact.version;

      const id = randomUUID();
      let dashboardArtifactId = input.dashboard
        ? await captureDashboard(null)
        : null;
      if (!dashboardArtifactId) {
        try {
          const draftFeed = projectFeed({
            experiment: {
              id,
              owner,
              driverAgentId,
              name: input.name,
              status: "draft",
              skeleton: input.skeleton,
              drift: [],
              scriptPath: input.script.path,
              scriptSha256: input.script.sha256,
              scriptArtifactId,
              scriptVersion,
              dashboardArtifactId: null,
              error: null,
              createdAt: now().toISOString(),
              executedAt: null,
              finishedAt: null,
              lastActivityAt: null,
            },
            spans: [],
            invocations: [],
            custom: null,
          });
          const dashboard = await artifactLibrary.create(
            {
              title: `${input.name} — dashboard`,
              content: injectFeedSnapshot(STOCK_DASHBOARD_HTML, draftFeed),
              fileName: "dashboard.html",
              kind: "html",
              folderId,
            },
            { agentId: driverAgentId, internal: true },
          );
          dashboardArtifactId = dashboard.id;
        } catch {}
      }

      await repo.insert({
        id,
        owner,
        driverAgentId,
        name: input.name,
        skeleton: input.skeleton,
        scriptPath: input.script.path,
        scriptSha256: input.script.sha256,
        scriptArtifactId,
        scriptVersion,
        dashboardArtifactId,
      });
      emitChanged(id, driverAgentId);
      return { experimentId: id };
    },

    async appendEvents(driverAgentId, experimentId, events: TraceEvent[]) {
      const experiment = await requireDriverExperiment(
        driverAgentId,
        experimentId,
      );
      if (experiment.status !== "running") {
        throw new ExperimentClosedError(experiment.status);
      }

      const knownStages = new Set([
        ...experiment.skeleton.stages.map((s) => s.id),
        ...experiment.drift,
      ]);
      const newDrift: string[] = [];
      const noteStage = (stage: string) => {
        if (!knownStages.has(stage)) {
          knownStages.add(stage);
          newDrift.push(stage);
        }
      };

      let scriptSha = experiment.scriptSha256;
      for (const event of events) {
        switch (event.type) {
          case "run-start": {
            if (event.scriptSha256 !== scriptSha) {
              if (event.scriptContent === undefined) {
                throw new ScriptContentRequiredError();
              }
              const updated = await artifactLibrary.update(
                experiment.scriptArtifactId,
                {
                  content: event.scriptContent,
                  fileName: scriptFileName(experiment.scriptPath),
                },
              );
              await repo.patchScript(experimentId, {
                scriptSha256: event.scriptSha256,
                scriptVersion: updated.version,
              });
              scriptSha = event.scriptSha256;
            }
            break;
          }
          case "stage-declare": {
            noteStage(event.stage);
            break;
          }
          case "span-start": {
            noteStage(event.stage);
            await repo.insertSpan(experimentId, {
              spanId: event.spanId,
              stage: event.stage,
              iteration: event.iteration ?? null,
              parentSpanId: event.parentSpanId ?? null,
              startedAt: new Date(event.ts),
            });
            break;
          }
          case "span-end": {
            await repo.endSpan(experimentId, {
              spanId: event.spanId,
              status: event.status,
              score: event.score ?? null,
              artifactIds: event.artifactIds ?? [],
              attrs: event.attrs ?? null,
              endedAt: new Date(event.ts),
            });
            break;
          }
          case "custom-data": {
            const merged =
              event.merge === false
                ? event.data
                : { ...(experiment.customData ?? {}), ...event.data };
            const bytes = Buffer.byteLength(JSON.stringify(merged), "utf8");
            if (bytes > CUSTOM_DATA_MAX_BYTES) {
              throw new CustomDataTooLargeError(bytes);
            }
            await repo.patchCustomData(experimentId, merged);
            experiment.customData = merged;
            break;
          }
          case "heartbeat": {
            break;
          }
        }
      }

      if (newDrift.length > 0) {
        await repo.appendDrift(experimentId, [
          ...experiment.drift,
          ...newDrift,
        ]);
      }
      await repo.bumpActivity(experimentId, now());
      emitChanged(experimentId, driverAgentId);
      return { accepted: events.length };
    },

    async finish(driverAgentId, experimentId, input: FinishInput) {
      const experiment = await requireDriverExperiment(
        driverAgentId,
        experimentId,
      );
      if (!canTransition(experiment.status, input.status)) {
        throw new ExperimentClosedError(experiment.status);
      }
      const flipped = await repo.transition(
        experimentId,
        "running",
        input.status,
        {
          finishedAt: now(),
          error: input.error ?? null,
        },
      );
      if (!flipped) {
        const current = await repo.get(experimentId, owner);
        throw new ExperimentClosedError(current?.status ?? "unknown");
      }
      emitChanged(experimentId, experiment.driverAgentId);
      await releasePin(experiment.driverAgentId);
      await snapshotDashboard(experimentId);
    },

    async attachArtifact(callerAgentId, artifactId, experimentId) {
      let row: ExperimentRow;
      if (experimentId !== undefined) {
        row = await requireDriverExperiment(callerAgentId, experimentId);
      } else {
        const viaInvocation =
          await deps.experimentForInvocation?.(callerAgentId);
        if (viaInvocation === null || viaInvocation === undefined) return null;
        const resolved = await repo.get(viaInvocation, owner);
        if (!resolved) return null;
        row = resolved;
      }
      if (row.status === "draft") throw new DraftAttachError();
      if (!row.attachedArtifactIds.includes(artifactId)) {
        await repo.setAttachedArtifacts(row.id, [
          ...row.attachedArtifactIds,
          artifactId,
        ]);
        emitChanged(row.id, row.driverAgentId);
      }
      return { experimentId: row.id };
    },
  };
}
