import type {
  ArtifactApiRequestInput,
  ArtifactApiRequestResult,
} from "agent-runtime-api";
import type {
  ArtifactCallAgentApiResult,
  ArtifactKind,
  ArtifactVisibility,
} from "api-server-api";

import type { AgentApiPodClient } from "../../modules/artifact-library/infrastructure/agent-api-pod-client.js";
import type {
  ArtifactLibraryRepository,
  ArtifactRow,
} from "../../modules/artifact-library/infrastructure/artifact-library-repository.js";
import { createArtifactLibraryService } from "../../modules/artifact-library/services/artifact-library-service.js";
import type { ArtifactService } from "../../modules/artifacts/services/artifact-service.js";

type AppAnswer = { status: number; contentType: string | null; body: string };

interface FakeAgent {
  awake: boolean;
  reachable: boolean;
  oldRuntime: boolean;
  app: ((request: ArtifactApiRequestInput) => AppAnswer) | null;
  received: string[];
}

export interface AgentHandle {
  hibernate(): AgentHandle;
  failToWake(): AgentHandle;
  runOldRuntime(): AgentHandle;
  serve(app: (request: ArtifactApiRequestInput) => AppAnswer): AgentHandle;
  isAwake(): boolean;
  received(): string[];
}

export interface PublishOptions {
  owner?: string;
  by?: string | null;
  kind?: ArtifactKind;
  interactive?: boolean;
  visibility?: ArtifactVisibility;
}

function unused(name: string): never {
  throw new Error(`${name} is not part of the artifact api world`);
}

function ownerScopedRepo(rows: ArtifactRow[]): ArtifactLibraryRepository {
  return new Proxy({} as ArtifactLibraryRepository, {
    get: (_target, method: string) =>
      method === "getArtifact"
        ? (id: string, owner: string) =>
            Promise.resolve(
              rows.find((r) => r.id === id && r.owner === owner) ?? null,
            )
        : () => unused(`repository.${method}`),
  });
}

function relay(agent: FakeAgent, request: ArtifactApiRequestInput) {
  if (agent.oldRuntime)
    return { ok: false, reason: "unsupported-runtime" } as const;
  if (!agent.app) return { ok: false, reason: "app-not-listening" } as const;
  agent.received.push(`${request.method} ${request.path}`);
  return { ok: true, ...agent.app(request) } satisfies ArtifactApiRequestResult;
}

export function createArtifactApiWorld() {
  const rows: ArtifactRow[] = [];
  const agents = new Map<string, FakeAgent>();

  function fakeAgent(agentId: string): FakeAgent {
    let agent = agents.get(agentId);
    if (!agent) {
      agent = {
        awake: true,
        reachable: true,
        oldRuntime: false,
        app: null,
        received: [],
      };
      agents.set(agentId, agent);
    }
    return agent;
  }

  const cluster = {
    ensureReady: (agentId: string) => {
      const agent = fakeAgent(agentId);
      if (!agent.reachable)
        return Promise.reject(new Error(`agent ${agentId} did not wake`));
      agent.awake = true;
      return Promise.resolve();
    },
    agentApi: {
      request: (agentId, input) => {
        const agent = fakeAgent(agentId);
        if (!agent.awake)
          return Promise.resolve({ ok: false, reason: "agent-unreachable" });
        return Promise.resolve(relay(agent, input));
      },
    } satisfies AgentApiPodClient,
  };

  function agent(agentId: string): AgentHandle {
    const state = fakeAgent(agentId);
    const handle: AgentHandle = {
      hibernate: () => ((state.awake = false), handle),
      failToWake: () => (
        (state.awake = false),
        (state.reachable = false),
        handle
      ),
      runOldRuntime: () => ((state.oldRuntime = true), handle),
      serve: (app) => ((state.app = app), handle),
      isAwake: () => state.awake,
      received: () => [...state.received],
    };
    return handle;
  }

  function publish(options: PublishOptions = {}): string {
    const id = `artifact-${rows.length + 1}`;
    const now = new Date();
    rows.push({
      id,
      owner: options.owner ?? "alice",
      agentId: options.by === undefined ? "agent-a" : options.by,
      folderId: null,
      sourcePath: null,
      title: "Dashboard",
      slug: `slug-${id}`,
      kind: options.kind ?? "html",
      contentType: "text/html",
      fileName: "dashboard.html",
      storageRef: `library/${id}/v1/dashboard.html`,
      sizeBytes: 10,
      version: 1,
      visibility: options.visibility ?? "private",
      interactive: options.interactive ?? true,
      expiresAt: null,
      viewCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  function call(
    artifactId: string,
    request: ArtifactApiRequestInput,
    caller: { as?: string; keyBoundTo?: readonly string[] } = {},
  ): Promise<ArtifactCallAgentApiResult> {
    const library = createArtifactLibraryService({
      repo: ownerScopedRepo(rows),
      artifacts: new Proxy({} as ArtifactService, {
        get: (_target, method: string) => () => unused(`artifacts.${method}`),
      }),
      owner: caller.as ?? "alice",
      surface: "ui",
      shareBaseUrl: "https://share.example.test",
      ensureReady: cluster.ensureReady,
      agentApi: cluster.agentApi,
    });
    return library.callAgentApi(
      { artifactId, ...request },
      { agentIds: caller.keyBoundTo ?? "*" },
    );
  }

  return { agent, publish, call };
}
