import { TRPCError } from "@trpc/server";
import type { Db } from "db";
import type {
  AgentsService,
  KbSharesService,
  KbShareView,
} from "api-server-api";
import { defaultShareRootsForKbTemplate } from "../knowledge-bases/index.js";
import type { ArtifactService } from "../artifacts/services/artifact-service.js";
import {
  kbShareRowId,
  parseShareString,
  secretsEqual,
} from "./domain/share-string.js";
import { createAgentsRuntimeRepo } from "../runtime-delivery/infrastructure/outbox-repo.js";
import { workspacePrefixFrom } from "./domain/workspace-path.js";
import {
  createAgentFilesClient,
  type AgentFilesClient,
} from "./infrastructure/agent-files-client.js";
import { createKbPublishClient } from "./infrastructure/kb-publish-client.js";
import {
  claimPublish,
  clearSnapshotPointer,
  findActiveShareByAgent,
  findActiveShareById,
  finishPublishFailure,
  finishPublishSuccess,
  insertShare,
  listActiveSharesByOwner,
  listDirtyActiveShares,
  markShareDirty,
  releasePublishClaim,
  revokeShareByAgent,
  updateSharePublicName,
  updateShareSecret,
  updateStaleSnapshots,
} from "./infrastructure/kb-shares-repository.js";
import {
  startKbShareAutoRefreshSaga,
  type KbShareAutoRefreshSaga,
} from "./sagas/auto-refresh.js";
import { createKbSharesService } from "./services/kb-shares-service.js";
import {
  createKbSharePublisher,
  type KbSharePublisher,
  type KbSharePublishLimits,
} from "./services/publish-service.js";

export type KbShareStorePort = Pick<
  ArtifactService,
  "put" | "get" | "delete" | "stat" | "createUploadUrl"
>;

export interface WorkspaceLocation {
  agentHome: string;
  agentWorkDir: string;
}

interface PublisherOpts {
  owner: string;
  db: Db;
  namespace: string;
  store: KbShareStorePort;
  ensureReady: (agentId: string) => Promise<void>;
  publishLimits?: Partial<KbSharePublishLimits>;
}

function composePublisher(opts: PublisherOpts): KbSharePublisher {
  const runtimeRepo = createAgentsRuntimeRepo(opts.db);
  return createKbSharePublisher({
    owner: opts.owner,
    repo: {
      claimPublish: claimPublish(opts.db),
      finishPublishSuccess: finishPublishSuccess(opts.db),
      finishPublishFailure: finishPublishFailure(opts.db),
      releasePublishClaim: releasePublishClaim(opts.db),
      updateStaleSnapshots: updateStaleSnapshots(opts.db),
      clearSnapshotPointer: clearSnapshotPointer(opts.db),
    },
    kbPublish: createKbPublishClient(opts.namespace),
    getRuntimeCapabilities: (agentId) =>
      runtimeRepo.get(agentId).then((r) => r?.runtimeCapabilities ?? null),
    store: opts.store,
    ensureReady: opts.ensureReady,
    ...(opts.publishLimits ? { limits: opts.publishLimits } : {}),
  });
}

function makeListWorkspaceRoots(
  files: AgentFilesClient,
  workspacePrefix: string,
): (agentId: string) => Promise<string[]> {
  return async (agentId) => {
    const [result] = await files.listDirs(agentId, [workspacePrefix]);
    if (!result || !result.ok) return [];
    return result.entries
      .filter((entry) => entry.type === "dir" && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  };
}

export function composeKbSharesForOwner(opts: {
  owner: string;
  db: Db;
  agents: Pick<AgentsService, "get">;
  namespace: string;
  store: KbShareStorePort;
  ensureReady: (agentId: string) => Promise<void>;
  workspace: WorkspaceLocation;
  objectStoreConfigured: boolean;
  publishLimits?: Partial<KbSharePublishLimits>;
}): { kbShares: KbSharesService } {
  const workspacePrefix = workspacePrefixFrom(
    opts.workspace.agentHome,
    opts.workspace.agentWorkDir,
  );
  const publisher = composePublisher(opts);
  const listWorkspaceRoots = makeListWorkspaceRoots(
    createAgentFilesClient(opts.namespace),
    workspacePrefix,
  );
  return {
    kbShares: createKbSharesService({
      owner: opts.owner,
      agents: opts.agents,
      findActiveByAgent: findActiveShareByAgent(opts.db),
      findActiveById: findActiveShareById(opts.db),
      listActiveByOwner: listActiveSharesByOwner(opts.db),
      insert: insertShare(opts.db),
      updateSecret: updateShareSecret(opts.db),
      updatePublicName: updateSharePublicName(opts.db),
      revokeByAgent: revokeShareByAgent(opts.db),
      publisher,
      defaultRootsForKbTemplate: defaultShareRootsForKbTemplate,
      listWorkspaceRoots,
      objectStoreConfigured: opts.objectStoreConfigured,
    }),
  };
}

export interface KbShareAgentOps {
  share(agentId: string): Promise<KbShareView>;
  refresh(agentId: string): Promise<KbShareView>;
  status(agentId: string): Promise<KbShareView | null>;
}

export function composeKbShareAgentOps(opts: {
  owner: string;
  db: Db;
  agents: Pick<AgentsService, "get">;
  namespace: string;
  store: KbShareStorePort;
  ensureReady: (agentId: string) => Promise<void>;
  workspace: WorkspaceLocation;
  objectStoreConfigured: boolean;
  publishLimits?: Partial<KbSharePublishLimits>;
}): KbShareAgentOps {
  const workspacePrefix = workspacePrefixFrom(
    opts.workspace.agentHome,
    opts.workspace.agentWorkDir,
  );
  const publisher = composePublisher(opts);
  const service = createKbSharesService({
    owner: opts.owner,
    agents: opts.agents,
    findActiveByAgent: findActiveShareByAgent(opts.db),
    findActiveById: findActiveShareById(opts.db),
    listActiveByOwner: listActiveSharesByOwner(opts.db),
    insert: insertShare(opts.db),
    updateSecret: updateShareSecret(opts.db),
    updatePublicName: updateSharePublicName(opts.db),
    revokeByAgent: revokeShareByAgent(opts.db),
    publisher,
    defaultRootsForKbTemplate: defaultShareRootsForKbTemplate,
    listWorkspaceRoots: makeListWorkspaceRoots(
      createAgentFilesClient(opts.namespace),
      workspacePrefix,
    ),
    objectStoreConfigured: opts.objectStoreConfigured,
    logActor: "agent",
  });
  return {
    async share(agentId) {
      const existing = await service.status(agentId);
      if (existing) return existing;
      return service.create({ agentId });
    },
    async refresh(agentId) {
      try {
        return await service.refresh({ agentId });
      } catch (err) {
        if (err instanceof TRPCError && err.code === "CONFLICT") {
          const current = await service.status(agentId);
          if (current) return current;
        }
        throw err;
      }
    },
    status: (agentId) => service.status(agentId),
  };
}

export function createShareStringVerifier(
  db: Db,
): (shareString: string) => Promise<boolean> {
  const findActiveById = findActiveShareById(db);
  return async (shareString) => {
    const parsed = parseShareString(shareString);
    if (!parsed) return false;
    const row = await findActiveById(kbShareRowId(parsed.shareId));
    return row !== null && secretsEqual(row.secret, parsed.secret);
  };
}

export function createKbShareResolver(
  db: Db,
): (
  shareId: string,
  presentedSecret: string | null,
) => Promise<{ name: string | null; reachable: boolean } | null> {
  const findActiveById = findActiveShareById(db);
  return async (shareId, presentedSecret) => {
    const row = await findActiveById(kbShareRowId(shareId));
    if (!row) return null;
    return {
      name: row.publicName ?? null,
      reachable:
        presentedSecret !== null && secretsEqual(row.secret, presentedSecret),
    };
  };
}

export function startKbShareAutoRefresh(opts: {
  db: Db;
  namespace: string;
  store: KbShareStorePort;
  ensureReady: (agentId: string) => Promise<void>;
  publishLimits?: Partial<KbSharePublishLimits>;
  debounceMs?: number;
}): KbShareAutoRefreshSaga {
  const findActive = findActiveShareByAgent(opts.db);
  return startKbShareAutoRefreshSaga({
    findActiveByAgent: findActive,
    listDirtyActive: listDirtyActiveShares(opts.db),
    markDirty: markShareDirty(opts.db),
    publishAs: async (owner, agentId) => {
      const publisher = composePublisher({
        owner,
        db: opts.db,
        namespace: opts.namespace,
        store: opts.store,
        ensureReady: opts.ensureReady,
        ...(opts.publishLimits ? { publishLimits: opts.publishLimits } : {}),
      });
      await publisher.startPublish(agentId);
    },
    ...(opts.debounceMs !== undefined ? { debounceMs: opts.debounceMs } : {}),
  });
}

export function createKbShareAgentCleanup(opts: {
  db: Db;
  namespace: string;
  store: KbShareStorePort;
}): (agentId: string) => Promise<void> {
  const revoke = revokeShareByAgent(opts.db);
  const publisher = composePublisher({
    owner: "system",
    db: opts.db,
    namespace: opts.namespace,
    store: opts.store,
    ensureReady: async () => {},
  });
  return async (agentId) => {
    const revoked = await revoke(agentId);
    if (revoked) await publisher.purgeShareObjects(revoked);
  };
}
