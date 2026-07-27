import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  CUSTOM_DATA_MAX_BYTES,
  experimentFolderName,
  type Experiment,
  type ExperimentDriverSummary,
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

/** Artifacts attach to runs, not drafts — a draft has no results yet. */
export class DraftAttachError extends Error {
  constructor() {
    super(
      "this experiment is a draft — start a run before attaching artifacts",
    );
    this.name = "DraftAttachError";
  }
}

/** The caller isn't this experiment's driver, or it doesn't exist — both read
 *  as unknown, mirroring the invocations attribution posture. */
export class UnknownExperimentError extends Error {
  constructor() {
    super("unknown experiment");
    this.name = "UnknownExperimentError";
  }
}

/** The ledger is closed: reports against a non-running experiment (stopped,
 *  finished, or reaped) are rejected so a loop dies on its next call. */
export class ExperimentClosedError extends Error {
  constructor(status: string) {
    super(`experiment is ${status}; the trace is closed`);
    this.name = "ExperimentClosedError";
  }
}

/** run-start announced a new script sha without carrying the source. */
export class ScriptContentRequiredError extends Error {
  constructor() {
    super(
      "script sha changed but no scriptContent was provided; send the full source with run-start",
    );
    this.name = "ScriptContentRequiredError";
  }
}

/** The merged custom-data blob outgrew its cap; the event is rejected so the
 *  loop hears about it instead of silently truncating. */
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
  repo: ExperimentsRepository;
  artifactLibrary: ArtifactLibraryServiceImpl;
  /** Invocations spawned under this experiment's spans (span↔spawn attach). */
  invocationsForExperiment: (
    driverAgentId: string,
    experimentId: string,
  ) => Promise<TraceFeedInvocation[]>;
  /** `running` Invocation counts per driver — the index's activity signal. */
  runningInvocationsByDriver: () => Promise<Map<string, number>>;
  /** The experiment an invocation target belongs to (via its invocation's
   *  span attach), keyed by the target's own agent id — the auto-attribution
   *  path for attachArtifact. Null when the agent isn't a target. */
  experimentForInvocation?: (targetAgentId: string) => Promise<string | null>;
  /** Mints the run's results artifact (renderer + final feed baked in) and
   *  repoints the run at it. Called after every terminal flip; best-effort. */
  snapshotDashboard?: (experimentId: string, owner: string) => Promise<void>;
  /** Stop's teeth: fail the experiment's running Invocations and reap their
   *  targets, so blocked spawn() waiters unblock immediately. */
  cancelInvocations?: (
    driverAgentId: string,
    experimentId: string,
  ) => Promise<void>;
  /** Hibernation pin: set at run start, released when the driver's last running
   *  experiment goes terminal. Optional — a composition without it (never the
   *  production apps) just doesn't pin. */
  pin?: {
    set(driverAgentId: string): Promise<void>;
    clear(driverAgentId: string): Promise<void>;
  };
  /** Delivers the launch prompt over the runtime channel. Required for
   *  startRun(); the harness REST composition may omit it. */
  launcher?: {
    launch(input: {
      agentId: string;
      experimentId: string;
      task: string;
    }): Promise<void>;
  };
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
  const now = deps.now ?? (() => new Date());

  async function lineageFolderId(name: string): Promise<string> {
    const folderName = experimentFolderName(name);
    const existing = (await artifactLibrary.listFolders()).find(
      (folder) => folder.name === folderName,
    );
    if (existing) return existing.id;
    return (await artifactLibrary.createFolder(folderName)).id;
  }

  /** Terminal bookkeeping, best-effort: mint the results artifact — a
   *  failure never disturbs the flip. */
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

  /** Release the pin only when the driver has no other running experiment —
   *  concurrent experiments on one driver share the pin. Best-effort: a
   *  failed clear is healed by the boot reconciliation. */
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

  /** The launch rail for a freshly inserted run row (born `running`): pin
   *  before launch (the wake must never race the idle checker); a failed
   *  launch lands in `failed` immediately — a run that never started can
   *  never report or finish. */
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
      await releasePin(row.driverAgentId);
      await snapshotDashboard(id);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "the experiment could not be launched",
      });
    }
    return toView((await repo.get(id, owner))!);
  }

  /** Resolve + attribute in one step: a foreign or missing experiment reads
   *  the same (unknown), so a driver can't probe other owners' ids. */
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
    // ---- owner surface (tRPC) ------------------------------------------------

    async list() {
      return (await repo.list(owner)).map(toView);
    },

    async driverSummaries() {
      const [experiments, running] = await Promise.all([
        repo.list(owner),
        deps.runningInvocationsByDriver(),
      ]);
      const byDriver = new Map<string, ExperimentDriverSummary>();
      // repo.list is newest-first, so each summary's experiments stay so.
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
      // Building and running are separate: the draft is source and persists.
      // A run captures the draft's current state — declaration copied onto a
      // new row, the script CLONED into the run's own artifact; the run
      // renders the draft's dashboard while live and the terminal snapshot
      // mints its own results artifact. Starting from a terminal run
      // resolves back to the lineage's draft; a deleted draft falls back to
      // the run itself.
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
            { agentId: source.driverAgentId },
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

      // Born running: the lineage draft persists, and the one-draft-per-name
      // index must stay free for it — a run never passes through draft. The
      // live run renders the DRAFT's dashboard (the renderer; data arrives
      // live); its own single-version results artifact is created at the
      // terminal transition with the final feed baked in.
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
      return launchRun(runId);
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
      // Stop must actually stop: fail the run's in-flight invocations (this
      // unblocks a loop parked inside spawn()'s poll at once) before the
      // pin release and snapshot. Best-effort like the rest of the terminal
      // bookkeeping.
      try {
        await deps.cancelInvocations?.(row.driverAgentId, id);
      } catch (err) {
        process.stderr.write(
          `[experiments] invocation cancel for ${id} failed: ${err instanceof Error ? err.message : err}\n`,
        );
      }
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
    },

    // ---- agent surface (harness REST, mesh-attributed) ------------------------

    async planRegister(driverAgentId, input: PlanRegisterInput) {
      const fileName = scriptFileName(input.script.path);

      /** Inline dashboard capture (SDK dashboard_path): re-version the
       *  draft's existing dashboard, or create the bespoke artifact. */
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
          } catch {
            // Deleted since — fall through to a fresh artifact.
          }
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
          { agentId: driverAgentId },
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
        // Stock dashboards refresh on re-registration too: a platform-
        // authored renderer (recognized by its baked feed snapshot — bespoke
        // captures never carry one) re-bakes against the current stock HTML
        // and the just-declared skeleton, so a platform redesign or a plan
        // change lands as the next version, the same build history the
        // script gets. Best-effort: a failure keeps the old version.
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
          } catch {
            // Next registration retries.
          }
        }
        await repo.updateDraft(draft.id, {
          skeleton: input.skeleton,
          scriptPath: input.script.path,
          scriptSha256: input.script.sha256,
          scriptVersion: version,
          dashboardArtifactId,
        });
        return { experimentId: draft.id };
      }

      // The draft's artifacts are the build's source of truth: each plan
      // re-registration re-versions the draft script (build history); runs
      // clone them at start and never touch these.
      const folderId = await lineageFolderId(input.name);
      const scriptArtifact = await artifactLibrary.create(
        {
          title: `${input.name} — script`,
          content: input.script.content,
          fileName,
          folderId,
        },
        { agentId: driverAgentId },
      );
      const scriptArtifactId = scriptArtifact.id;
      const scriptVersion = scriptArtifact.version;

      const id = randomUUID();
      let dashboardArtifactId = input.dashboard
        ? await captureDashboard(null)
        : null;
      if (!dashboardArtifactId) {
        try {
          // Bake the plan into v1 so even the first version renders the
          // declared skeleton standalone — never a bare waiting state.
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
            { agentId: driverAgentId },
          );
          dashboardArtifactId = dashboard.id;
        } catch {
          // The dashboard is a rendering nicety — the detail view falls back
          // to its native summary when absent. The script publish above is
          // the one that must not fail silently.
        }
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
            // Later events in this batch merge onto the fresh blob.
            experiment.customData = merged;
            break;
          }
          case "heartbeat": {
            // Pure liveness: nothing to store — the batch-level
            // bumpActivity below is the whole effect.
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
      // Lost the race to Stop or the sweep — the run is terminal either way.
      if (!flipped) {
        const current = await repo.get(experimentId, owner);
        throw new ExperimentClosedError(current?.status ?? "unknown");
      }
      await releasePin(experiment.driverAgentId);
      await snapshotDashboard(experimentId);
    },

    async attachArtifact(callerAgentId, artifactId, experimentId) {
      let row: ExperimentRow;
      if (experimentId !== undefined) {
        // Explicit target: only the run's own driver may attach, and a
        // foreign or missing id reads as unknown (attribution posture).
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
      }
      return { experimentId: row.id };
    },
  };
}
