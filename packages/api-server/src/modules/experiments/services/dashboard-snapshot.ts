import { emit, EventType } from "../../../events.js";
import { experimentFolderName, type TraceFeedInvocation } from "api-server-api";
import type { Db } from "db";
import type { ArtifactLibraryServiceImpl } from "../../artifact-library/index.js";
import {
  createInvocationsRepository,
  type InvocationsRepository,
} from "../../invocations/infrastructure/invocations-repository.js";
import { injectFeedSnapshot } from "../domain/feed-snapshot.js";
import { projectFeed } from "../domain/trace-graph.js";
import {
  createExperimentsRepository,
  type ExperimentsRepository,
} from "../infrastructure/experiments-repository.js";
import { toSpanView, toView } from "./experiments-service.js";

const FEED_INVOCATIONS_MAX = 500;

export async function listFeedInvocations(
  invocationsRepo: Pick<InvocationsRepository, "listByExperiment">,
  driverAgentId: string,
  experimentId: string,
): Promise<TraceFeedInvocation[]> {
  const rows = await invocationsRepo.listByExperiment(
    driverAgentId,
    experimentId,
    FEED_INVOCATIONS_MAX,
  );
  return rows.map((row) => ({
    id: row.id,
    spanId: row.experimentSpanId?.slice(experimentId.length + 1) ?? null,
    status: row.status,
  }));
}

export type DashboardSnapshotter = (
  experimentId: string,
  owner: string,
) => Promise<void>;

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

    const [spans, invocations] = await Promise.all([
      repo.listSpans(experimentId),
      listFeedInvocations(invocationsRepo, row.driverAgentId, experimentId),
    ]);
    const feed = projectFeed({
      experiment: toView(row),
      spans: spans.map(toSpanView),
      invocations,
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
      { author: "agent", agentId: row.driverAgentId, internal: true },
    );
    await repo.patchDashboardArtifact(experimentId, results.id);
    emit({
      type: EventType.ExperimentChanged,
      experimentId,
      agentId: row.driverAgentId,
      ownerSub: owner,
    });
  };
}
