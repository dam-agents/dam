import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type {
  ExperimentRun,
  ExperimentsService,
  ExperimentWithRuns,
  UserIdentity,
} from "api-server-api";

import type { Artifact } from "../../modules/artifacts/domain/artifact-store.js";
import type { ArtifactService } from "../../modules/artifacts/services/artifact-service.js";
import { createCandidateRoutes } from "../../modules/experiments/candidate-route.js";

const OWNER = "owner-1";

function makeUser(sub: string): UserIdentity {
  return { sub, preferredUsername: sub, scopes: [], agentIds: "*" };
}

function makeRun(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    id: "run-1",
    experimentId: "exp-1",
    agentId: "agent-1",
    runNumber: 1,
    sessionId: "sess-1",
    candidateRef: "exp-1/agent-1/uuid/candidate.zip",
    score: 0.9,
    status: "completed",
    startedAt: "2026-06-26T00:00:00.000Z",
    endedAt: null,
    ...overrides,
  };
}

function makeExperiment(runs: ExperimentRun[]): ExperimentWithRuns {
  return {
    id: "exp-1",
    ownerId: OWNER,
    name: "Exp",
    goal: "Goal",
    spec: {},
    status: "running",
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
    arms: [
      {
        experimentId: "exp-1",
        agentId: "agent-1",
        armSpec: {},
        createdAt: "2026-06-26T00:00:00.000Z",
        runs,
      },
    ],
  };
}

function notImplemented(): never {
  throw new Error("not implemented in test");
}

function fakeExperiments(
  byOwner: Map<string, ExperimentWithRuns>,
): (owner: string) => ExperimentsService {
  return (owner) => ({
    list: notImplemented,
    getWithRuns: async (id) => {
      const experiment = byOwner.get(owner);
      return experiment && experiment.id === id ? experiment : null;
    },
    create: notImplemented,
    addArm: notImplemented,
    start: notImplemented,
    stop: notImplemented,
    delete: notImplemented,
    resolveActiveArm: notImplemented,
    recordRun: notImplemented,
  });
}

function fakeArtifacts(blobs: Map<string, Artifact>): ArtifactService {
  return {
    put: notImplemented,
    get: async (key) => blobs.get(key) ?? null,
    exists: async (key) => blobs.has(key),
  };
}

function buildApp(deps: {
  experimentsFor: (owner: string) => ExperimentsService;
  artifacts: ArtifactService;
  user: UserIdentity;
}) {
  const app = new Hono<{
    Variables: { user: UserIdentity; roles: string[] };
  }>();
  app.use("*", async (c, next) => {
    c.set("user", deps.user);
    await next();
  });
  app.route("/", createCandidateRoutes(deps));
  return app;
}

describe("candidate download route", () => {
  it("streams the candidate blob for an owned run", async () => {
    const run = makeRun();
    const experiments = new Map([[OWNER, makeExperiment([run])]]);
    const blob: Artifact = {
      key: run.candidateRef!,
      content: Buffer.from("zip-bytes"),
      contentType: "application/zip",
      sizeBytes: 9,
      createdAt: new Date("2026-06-26T00:00:00.000Z"),
    };
    const app = buildApp({
      experimentsFor: fakeExperiments(experiments),
      artifacts: fakeArtifacts(new Map([[blob.key, blob]])),
      user: makeUser(OWNER),
    });

    const res = await app.request(
      "/api/experiments/exp-1/runs/run-1/candidate",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="candidate.zip"',
    );
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("zip-bytes");
  });

  it("404s when the experiment is not owned by the caller", async () => {
    const experiments = new Map([[OWNER, makeExperiment([makeRun()])]]);
    const app = buildApp({
      experimentsFor: fakeExperiments(experiments),
      artifacts: fakeArtifacts(new Map()),
      user: makeUser("intruder"),
    });

    const res = await app.request(
      "/api/experiments/exp-1/runs/run-1/candidate",
    );
    expect(res.status).toBe(404);
  });

  it("404s when the run has no candidate", async () => {
    const run = makeRun({ candidateRef: null });
    const experiments = new Map([[OWNER, makeExperiment([run])]]);
    const app = buildApp({
      experimentsFor: fakeExperiments(experiments),
      artifacts: fakeArtifacts(new Map()),
      user: makeUser(OWNER),
    });

    const res = await app.request(
      "/api/experiments/exp-1/runs/run-1/candidate",
    );
    expect(res.status).toBe(404);
  });

  it("404s when the blob is missing from the store", async () => {
    const experiments = new Map([[OWNER, makeExperiment([makeRun()])]]);
    const app = buildApp({
      experimentsFor: fakeExperiments(experiments),
      artifacts: fakeArtifacts(new Map()),
      user: makeUser(OWNER),
    });

    const res = await app.request(
      "/api/experiments/exp-1/runs/run-1/candidate",
    );
    expect(res.status).toBe(404);
  });
});
