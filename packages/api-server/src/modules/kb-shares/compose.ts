import type { Db } from "db";
import type {
  AgentsService,
  KbSharesService,
  KbShareView,
} from "api-server-api";
import {
  MAX_FILES,
  PER_FILE_MAX_BYTES,
  TOTAL_MAX_BYTES,
} from "agent-runtime-api/kb-snapshot";
import { defaultShareRootsForKbTemplate } from "../knowledge-bases/index.js";
import type { ArtifactService } from "../artifacts/services/artifact-service.js";
import { createAgentsRuntimeRepo } from "../runtime-delivery/infrastructure/outbox-repo.js";
import {
  kbShareRowId,
  parseShareString,
  secretsEqual,
} from "./domain/share-string.js";
import { workspacePrefixFrom } from "./domain/workspace-path.js";
import {
  createAgentFilesClient,
  type AgentFilesClient,
} from "./infrastructure/agent-files-client.js";
import { createKbPublishPodClient } from "./infrastructure/kb-publish-client.js";
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
  releasePublishClaim,
  revokeShareByAgent,
  updateSharePublicName,
  updateShareRoots,
  updateShareSecret,
} from "./infrastructure/kb-shares-repository.js";
import {
  startKbShareSyncSaga,
  type KbShareSyncSaga,
} from "./sagas/auto-refresh.js";
import { createKbSharesService } from "./services/kb-shares-service.js";
import {
  createKbShareFlushNudge,
  type KbShareFlushNudge,
} from "./services/publish-nudge.js";
import {
  createKbSharePublishGate,
  type KbSharePublishGate,
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

function resolveLimits(
  partial?: Partial<KbSharePublishLimits>,
): KbSharePublishLimits {
  return {
    perFileMaxBytes: partial?.perFileMaxBytes ?? PER_FILE_MAX_BYTES,
    totalMaxBytes: partial?.totalMaxBytes ?? TOTAL_MAX_BYTES,
    maxFiles: partial?.maxFiles ?? MAX_FILES,
  };
}

export function composeKbPublishGate(opts: {
  db: Db;
  store: KbShareStorePort;
  publishLimits?: Partial<KbSharePublishLimits>;
}): KbSharePublishGate {
  return createKbSharePublishGate({
    repo: {
      claimPublish: claimPublish(opts.db),
      finishPublishSuccess: finishPublishSuccess(opts.db),
      finishPublishFailure: finishPublishFailure(opts.db),
      releasePublishClaim: releasePublishClaim(opts.db),
      clearSnapshotPointer: clearSnapshotPointer(opts.db),
    },
    findActiveByAgent: findActiveShareByAgent(opts.db),
    store: opts.store,
    ...(opts.publishLimits ? { limits: opts.publishLimits } : {}),
  });
}

function composeNudge(opts: {
  db: Db;
  namespace: string;
  ensureReady: (agentId: string) => Promise<void>;
  publishLimits?: Partial<KbSharePublishLimits>;
}): KbShareFlushNudge {
  const runtimeRepo = createAgentsRuntimeRepo(opts.db);
  return createKbShareFlushNudge({
    findActiveByAgent: findActiveShareByAgent(opts.db),
    ensureReady: opts.ensureReady,
    getRuntimeCapabilities: (agentId) =>
      runtimeRepo.get(agentId).then((r) => r?.runtimeCapabilities ?? null),
    pod: createKbPublishPodClient(opts.namespace),
    repo: {
      claimPublish: claimPublish(opts.db),
      finishPublishFailure: finishPublishFailure(opts.db),
    },
    limits: resolveLimits(opts.publishLimits),
    log: (message) => process.stderr.write(`[kb-share-nudge] ${message}\n`),
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

interface ComposeShareServiceOpts {
  owner: string;
  db: Db;
  agents: Pick<AgentsService, "get">;
  namespace: string;
  store: KbShareStorePort;
  ensureReady: (agentId: string) => Promise<void>;
  workspace: WorkspaceLocation;
  objectStoreConfigured: boolean;
  publishLimits?: Partial<KbSharePublishLimits>;
  logActor?: "user" | "agent";
}

function composeShareService(opts: ComposeShareServiceOpts): KbSharesService {
  const workspacePrefix = workspacePrefixFrom(
    opts.workspace.agentHome,
    opts.workspace.agentWorkDir,
  );
  const gate = composeKbPublishGate(opts);
  const nudge = composeNudge(opts);
  return createKbSharesService({
    owner: opts.owner,
    agents: opts.agents,
    findActiveByAgent: findActiveShareByAgent(opts.db),
    findActiveById: findActiveShareById(opts.db),
    listActiveByOwner: listActiveSharesByOwner(opts.db),
    insert: insertShare(opts.db),
    updateSecret: updateShareSecret(opts.db),
    updatePublicName: updateSharePublicName(opts.db),
    updateRoots: updateShareRoots(opts.db),
    revokeByAgent: revokeShareByAgent(opts.db),
    purgeShareObjects: (row) => gate.purgeShareObjects(row),
    requestFlush: (agentId) => nudge.requestFlush(agentId),
    unconfigurePod: (agentId) => nudge.unconfigure(agentId),
    defaultRootsForKbTemplate: defaultShareRootsForKbTemplate,
    listWorkspaceRoots: makeListWorkspaceRoots(
      createAgentFilesClient(opts.namespace),
      workspacePrefix,
    ),
    objectStoreConfigured: opts.objectStoreConfigured,
    ...(opts.logActor ? { logActor: opts.logActor } : {}),
  });
}

export function composeKbSharesForOwner(
  opts: Omit<ComposeShareServiceOpts, "logActor">,
): { kbShares: KbSharesService } {
  return { kbShares: composeShareService(opts) };
}

export interface KbShareAgentOps {
  share(agentId: string): Promise<KbShareView>;
  refresh(agentId: string): Promise<KbShareView>;
  status(agentId: string): Promise<KbShareView | null>;
}

export function composeKbShareAgentOps(
  opts: Omit<ComposeShareServiceOpts, "logActor">,
): KbShareAgentOps {
  const service = composeShareService({ ...opts, logActor: "agent" });
  return {
    async share(agentId) {
      const existing = await service.status(agentId);
      if (existing) return existing;
      return service.create({ agentId });
    },
    refresh: (agentId) => service.refresh({ agentId }),
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

export function startKbShareSync(opts: {
  db: Db;
  namespace: string;
}): KbShareSyncSaga {
  const nudge = composeNudge({
    db: opts.db,
    namespace: opts.namespace,
    ensureReady: async () => {},
  });
  return startKbShareSyncSaga({
    listDirtyActive: listDirtyActiveShares(opts.db),
    attemptSync: (agentId) => nudge.attemptSync(agentId),
  });
}

export function createKbShareAgentCleanup(opts: {
  db: Db;
  store: KbShareStorePort;
}): (agentId: string) => Promise<void> {
  const revoke = revokeShareByAgent(opts.db);
  const gate = composeKbPublishGate({ db: opts.db, store: opts.store });
  return async (agentId) => {
    const revoked = await revoke(agentId);
    if (revoked) await gate.purgeShareObjects(revoked);
  };
}
