import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";
import type { ArtifactService } from "../../artifacts/services/artifact-service.js";
import {
  AgentFileNotFoundError,
  AgentFileTooLargeError,
  type AgentFilesClient,
} from "../infrastructure/agent-files-client.js";
import {
  MANIFEST_VERSION,
  MAX_FILES,
  PER_FILE_MAX_BYTES,
  PublishFailure,
  STALE_SNAPSHOT_GRACE_MS,
  TOTAL_MAX_BYTES,
  contentHash,
  fileObjectKey,
  manifestKey,
  mintSnapshotId,
  parseManifest,
  shouldConsiderFileName,
  type SnapshotManifest,
  type SnapshotManifestFile,
  type StaleSnapshotEntry,
} from "../domain/snapshot.js";
import {
  createSearchIndexBuilder,
  searchIndexKey,
} from "../domain/search-index.js";
import { shareIdFromRowId } from "../domain/share-string.js";
import {
  joinWorkspacePath,
  stripWorkspacePrefix,
} from "../domain/workspace-path.js";
import type { KbShareRow } from "../domain/types.js";

const LIST_DIRS_BATCH = 500;
const READ_CONCURRENCY = 4;
const STALE_CLAIM_MS = 15 * 60 * 1000;
const MAX_WALK_DEPTH = 64;

export interface KbSharePublisher {
  startPublish(
    agentId: string,
    opts?: { roots?: readonly string[] },
  ): Promise<KbShareRow | null>;
  purgeShareObjects(row: KbShareRow): Promise<void>;
}

export interface KbSharePublisherDeps {
  owner: string;
  repo: {
    claimPublish(
      agentId: string,
      opts: { roots?: readonly string[]; staleClaimMs: number },
    ): Promise<KbShareRow | null>;
    finishPublishSuccess(
      agentId: string,
      result: {
        snapshotId: string;
        snapshotManifestKey: string;
        snapshotCreatedAt: Date;
        documentCount: number;
        totalSizeBytes: number;
        staleSnapshots: readonly StaleSnapshotEntry[];
      },
      expectedToken: string,
      claimStartedAt: Date,
    ): Promise<boolean>;
    finishPublishFailure(
      agentId: string,
      error: string,
      expectedToken: string,
    ): Promise<boolean>;
    releasePublishClaim(
      agentId: string,
      expectedToken: string,
    ): Promise<boolean>;
    updateStaleSnapshots(
      rowId: string,
      entries: readonly StaleSnapshotEntry[],
    ): Promise<void>;
    clearSnapshotPointer(rowId: string): Promise<void>;
  };
  files: AgentFilesClient;
  store: Pick<ArtifactService, "put" | "get" | "delete">;
  ensureReady(agentId: string): Promise<void>;
  workspacePrefix: string;
  limits?: Partial<KbSharePublishLimits>;
  now?: () => Date;
}

export interface KbSharePublishLimits {
  perFileMaxBytes: number;
  totalMaxBytes: number;
  maxFiles: number;
}

interface CollectedFile {
  readPath: string;
  path: string;
  root: string;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let aborted = false;
  let firstError: unknown;
  const worker = async (): Promise<void> => {
    while (!aborted && next < items.length) {
      const index = next;
      next += 1;
      try {
        await task(items[index]!);
      } catch (err) {
        aborted = true;
        if (firstError === undefined) firstError = err;
        return;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  if (firstError !== undefined) throw firstError;
}

export function createKbSharePublisher(
  deps: KbSharePublisherDeps,
): KbSharePublisher {
  const now = deps.now ?? (() => new Date());
  const limits: KbSharePublishLimits = {
    perFileMaxBytes: deps.limits?.perFileMaxBytes ?? PER_FILE_MAX_BYTES,
    totalMaxBytes: deps.limits?.totalMaxBytes ?? TOTAL_MAX_BYTES,
    maxFiles: deps.limits?.maxFiles ?? MAX_FILES,
  };

  async function collectFiles(row: KbShareRow): Promise<CollectedFile[]> {
    const collected: CollectedFile[] = [];
    let pending: { path: string; root: string; depth: number }[] =
      row.roots.map((root) => ({
        path: joinWorkspacePath(deps.workspacePrefix, root),
        root,
        depth: 0,
      }));
    const topRoots = new Set(pending.map((item) => item.path));
    const visited = new Set<string>(pending.map((item) => item.path));
    while (pending.length > 0) {
      const batch = pending.slice(0, LIST_DIRS_BATCH);
      pending = pending.slice(LIST_DIRS_BATCH);
      const results = await deps.files.listDirs(
        row.agentId,
        batch.map((item) => item.path),
      );
      for (const [index, result] of results.entries()) {
        const origin = batch[index]!;
        if (!result.ok) {
          if (topRoots.has(result.path)) {
            throw new PublishFailure(
              `share root "${origin.root}" was not found in the workspace — remove it from the share or create it`,
            );
          }
          continue;
        }
        for (const entry of result.entries) {
          if (entry.name.startsWith(".")) continue;
          const childPath = `${result.path}/${entry.name}`;
          if (entry.type === "dir") {
            if (origin.depth + 1 > MAX_WALK_DEPTH) {
              throw new PublishFailure(
                `the share tree is deeper than ${MAX_WALK_DEPTH} levels — narrow the share roots or remove any directory cycle`,
              );
            }
            if (visited.has(childPath)) continue;
            visited.add(childPath);
            pending.push({
              path: childPath,
              root: origin.root,
              depth: origin.depth + 1,
            });
          } else if (shouldConsiderFileName(entry.name)) {
            collected.push({
              readPath: childPath,
              path: stripWorkspacePrefix(deps.workspacePrefix, childPath),
              root: origin.root,
            });
            if (collected.length > limits.maxFiles) {
              throw new PublishFailure(
                `the share contains more than ${limits.maxFiles} files — narrow the share roots`,
              );
            }
          }
        }
      }
    }
    return collected;
  }

  async function uploadFiles(
    row: KbShareRow,
    snapshotId: string,
    candidates: readonly CollectedFile[],
    indexText: (path: string, text: string) => void,
    writtenKeys: Set<string>,
  ): Promise<SnapshotManifestFile[]> {
    const shareId = shareIdFromRowId(row.id);
    const files: SnapshotManifestFile[] = [];
    const includedPerRoot = new Map<string, number>(
      row.roots.map((root) => [root, 0]),
    );
    let totalBytes = 0;
    await mapWithConcurrency(
      candidates,
      READ_CONCURRENCY,
      async (candidate) => {
        let result;
        try {
          result = await deps.files.read(row.agentId, candidate.readPath);
        } catch (err) {
          if (
            err instanceof AgentFileTooLargeError ||
            err instanceof AgentFileNotFoundError
          ) {
            return;
          }
          throw err;
        }
        if (result.binary) return;
        const content = Buffer.from(result.content, "utf8");
        if (content.byteLength > limits.perFileMaxBytes) return;
        totalBytes += content.byteLength;
        if (totalBytes > limits.totalMaxBytes) {
          throw new PublishFailure(
            `the share exceeds ${Math.floor(limits.totalMaxBytes / (1024 * 1024))} MB of text content — narrow the share roots`,
          );
        }
        const key = fileObjectKey(shareId, snapshotId, candidate.path);
        writtenKeys.add(key);
        await deps.store.put({
          key,
          content,
          contentType: result.mimeType || "text/plain",
        });
        files.push({
          path: candidate.path,
          sizeBytes: content.byteLength,
          contentHash: contentHash(content),
          key,
        });
        indexText(candidate.path, result.content);
        includedPerRoot.set(
          candidate.root,
          (includedPerRoot.get(candidate.root) ?? 0) + 1,
        );
      },
    );
    for (const [root, count] of includedPerRoot) {
      if (count === 0) {
        throw new PublishFailure(
          `share root "${root}" contains no publishable text files`,
        );
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return files;
  }

  async function gcStaleSnapshots(
    rowId: string,
    stale: readonly StaleSnapshotEntry[],
    currentKeys: ReadonlySet<string>,
  ): Promise<void> {
    const keep: StaleSnapshotEntry[] = [];
    const nowMs = now().getTime();
    for (const entry of stale) {
      if (nowMs - Date.parse(entry.replacedAt) < STALE_SNAPSHOT_GRACE_MS) {
        keep.push(entry);
        continue;
      }
      await deleteSnapshotObjects(entry.manifestKey, currentKeys);
    }
    if (keep.length !== stale.length) {
      await deps.repo.updateStaleSnapshots(rowId, keep);
    }
  }

  async function deleteSnapshotObjects(
    snapshotManifestKey: string,
    keysInUse: ReadonlySet<string>,
  ): Promise<void> {
    const stored = await deps.store.get(snapshotManifestKey);
    if (stored) {
      const manifest = parseManifest(stored.content.toString("utf8"));
      if (manifest) {
        for (const file of manifest.files) {
          if (!keysInUse.has(file.key)) {
            await deps.store.delete(file.key);
          }
        }
        if (manifest.searchIndexKey) {
          await deps.store.delete(manifest.searchIndexKey);
        }
      }
    }
    await deps.store.delete(snapshotManifestKey);
  }

  async function cleanupKeys(keys: Iterable<string>): Promise<void> {
    for (const key of keys) {
      await deps.store.delete(key).catch(() => {});
    }
  }

  function isAgentUnavailable(err: unknown): boolean {
    return (
      err instanceof Error &&
      (err.name === "AgentStoppedError" || err.name === "AgentWakeTimeoutError")
    );
  }

  async function runPublish(claimed: KbShareRow): Promise<void> {
    const { agentId } = claimed;
    const claimedAt = claimed.updatedAt;
    const claimToken = claimed.publishToken ?? "";
    const writtenKeys = new Set<string>();
    try {
      await deps.ensureReady(agentId);
      const candidates = await collectFiles(claimed);
      const snapshotId = mintSnapshotId();
      const indexBuilder = createSearchIndexBuilder();
      const files = await uploadFiles(
        claimed,
        snapshotId,
        candidates,
        indexBuilder.add,
        writtenKeys,
      );
      const createdAt = now();
      const totalSizeBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
      const shareId = shareIdFromRowId(claimed.id);
      const index = indexBuilder.finalize();
      const indexKey = searchIndexKey(shareId, snapshotId);
      writtenKeys.add(indexKey);
      await deps.store.put({
        key: indexKey,
        content: Buffer.from(JSON.stringify(index), "utf8"),
        contentType: "application/json",
      });
      const manifest: SnapshotManifest = {
        version: MANIFEST_VERSION,
        snapshotId,
        createdAt: createdAt.toISOString(),
        roots: claimed.roots,
        files,
        documentCount: files.length,
        totalSizeBytes,
        searchIndexKey: indexKey,
        searchDegraded: index.degraded,
      };
      const snapshotManifestKey = manifestKey(shareId, snapshotId);
      writtenKeys.add(snapshotManifestKey);
      await deps.store.put({
        key: snapshotManifestKey,
        content: Buffer.from(JSON.stringify(manifest), "utf8"),
        contentType: "application/json",
      });
      const staleSnapshots: StaleSnapshotEntry[] =
        claimed.snapshotId && claimed.snapshotManifestKey
          ? [
              ...claimed.staleSnapshots,
              {
                snapshotId: claimed.snapshotId,
                manifestKey: claimed.snapshotManifestKey,
                replacedAt: createdAt.toISOString(),
              },
            ]
          : [...claimed.staleSnapshots];
      const won = await deps.repo.finishPublishSuccess(
        agentId,
        {
          snapshotId,
          snapshotManifestKey,
          snapshotCreatedAt: createdAt,
          documentCount: files.length,
          totalSizeBytes,
          staleSnapshots,
        },
        claimToken,
        claimedAt,
      );
      if (!won) {
        await cleanupKeys(writtenKeys);
        return;
      }
      securityLog("info", "kb_share.published", {
        category: "resource",
        actor: deps.owner,
        actorKind: "user",
        agentId,
        result: "success",
        detail: { snapshotId, documentCount: files.length, totalSizeBytes },
      });
      emit({
        type: EventType.KbSharePublished,
        agentId,
        ownerSub: claimed.owner,
      });
      try {
        const currentKeys = new Set(files.map((f) => f.key));
        currentKeys.add(snapshotManifestKey);
        currentKeys.add(indexKey);
        await gcStaleSnapshots(claimed.id, staleSnapshots, currentKeys);
      } catch (err) {
        process.stderr.write(
          `[kb-share-publish] snapshot gc failed for ${agentId}: ${err}\n`,
        );
      }
    } catch (err) {
      await cleanupKeys(writtenKeys);
      if (isAgentUnavailable(err)) {
        await deps.repo
          .releasePublishClaim(agentId, claimToken)
          .catch(() => {});
        return;
      }
      const reason =
        err instanceof PublishFailure
          ? err.message
          : `publish failed: ${err instanceof Error ? err.message : String(err)}`;
      await deps.repo
        .finishPublishFailure(agentId, reason, claimToken)
        .catch(() => {});
      securityLog("warn", "kb_share.publish_failed", {
        category: "resource",
        actor: deps.owner,
        actorKind: "user",
        agentId,
        result: "failure",
        reason,
      });
      emit({
        type: EventType.KbSharePublishFailed,
        agentId,
        ownerSub: claimed.owner,
        reason,
      });
    }
  }

  return {
    async startPublish(agentId, opts) {
      const claimed = await deps.repo.claimPublish(agentId, {
        ...(opts?.roots ? { roots: opts.roots } : {}),
        staleClaimMs: STALE_CLAIM_MS,
      });
      if (!claimed) return null;
      void runPublish(claimed);
      return claimed;
    },

    async purgeShareObjects(row) {
      const empty = new Set<string>();
      if (row.snapshotManifestKey) {
        await deleteSnapshotObjects(row.snapshotManifestKey, empty);
      }
      for (const entry of row.staleSnapshots) {
        await deleteSnapshotObjects(entry.manifestKey, empty);
      }
      await deps.repo.clearSnapshotPointer(row.id);
    },
  };
}
