import { experimentFolderName } from "api-server-api";
import type { Db } from "db";
import type { ArtifactLibraryServiceImpl } from "../../artifact-library/index.js";
import { createInvocationsRepository } from "../../invocations/infrastructure/invocations-repository.js";
import { injectFeedSnapshot } from "../domain/feed-snapshot.js";
import { projectFeed } from "../domain/trace-graph.js";
import {
  createExperimentsRepository,
  type ExperimentsRepository,
} from "../infrastructure/experiments-repository.js";
import { toSpanView, toView } from "./experiments-service.js";

/** Cap mirrors the live feed's invocation join. */
const FEED_INVOCATIONS_MAX = 500;

export type DashboardSnapshotter = (
  experimentId: string,
  owner: string,
) => Promise<void>;

/** Create the run's single-version results artifact at its terminal
 *  transition: the current renderer (the draft's dashboard, which the live
 *  run pointed at) with the final Trace Feed baked in — self-contained and
 *  shareable — then point the run at it. Best-effort by contract: callers
 *  invoke it after the terminal flip and must never let a snapshot failure
 *  disturb the transition. Owner-agnostic: both the owner-scoped service and
 *  the boot-level inactivity sweep share this one implementation. */
export function createDashboardSnapshotter(deps: {
  db: Db;
  artifactLibraryFor: (owner: string) => ArtifactLibraryServiceImpl;
  repo?: ExperimentsRepository;
}): DashboardSnapshotter {
  const repo = deps.repo ?? createExperimentsRepository(deps.db);
  const invocationsRepo = createInvocationsRepository(deps.db);

  return async function snapshot(experimentId, owner) {
    const row = await repo.get(experimentId, owner);
    if (!row?.dashboardArtifactId) return;
    const artifactLibrary = deps.artifactLibraryFor(owner);
    const renderer = await artifactLibrary.getContent(row.dashboardArtifactId);
    if (!renderer || renderer.binary || renderer.tooLarge) return;

    const [spans, invocationRows] = await Promise.all([
      repo.listSpans(experimentId),
      invocationsRepo.listByExperiment(
        row.driverAgentId,
        experimentId,
        FEED_INVOCATIONS_MAX,
      ),
    ]);
    const feed = projectFeed({
      experiment: toView(row),
      spans: spans.map(toSpanView),
      invocations: invocationRows.map((invocation) => ({
        id: invocation.id,
        spanId:
          invocation.experimentSpanId?.slice(experimentId.length + 1) ?? null,
        status: invocation.status,
      })),
      custom: row.customData,
      attachedArtifactIds: row.attachedArtifactIds,
    });

    const runNumber =
      (await repo.countRuns(row.driverAgentId, row.name, row.createdAt)) + 1;
    const folderId = (await artifactLibrary.listFolders()).find(
      (folder) => folder.name === experimentFolderName(row.name),
    )?.id;
    const results = await artifactLibrary.create(
      {
        title: `${row.name} — run ${runNumber} results`,
        content: injectFeedSnapshot(renderer.content, feed),
        fileName: "results.html",
        kind: "html",
        ...(folderId ? { folderId } : {}),
      },
      { agentId: row.driverAgentId },
    );
    await repo.patchDashboardArtifact(experimentId, results.id);
  };
}
