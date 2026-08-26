import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";
import type {
  KbPublishPlan,
  KbPublishPlanFile,
  KbPublishSegmentReport,
} from "agent-runtime-api";
import {
  INDEX_FORMAT_VERSION,
  MAX_WALK_DEPTH,
  MAX_FILES,
  PER_FILE_MAX_BYTES,
  TOTAL_MAX_BYTES,
  bucketForPath,
  chooseBucketCount,
  parseManifest,
  segmentContentId,
  type KbPublishCaps,
  type SegmentMember,
  type SnapshotManifest,
  type SnapshotManifestFile,
  type SnapshotSearchSegment,
} from "agent-runtime-api/kb-snapshot";

import type { ArtifactService } from "../../artifacts/services/artifact-service.js";
import type { KbPublishClient } from "../infrastructure/kb-publish-client.js";
import {
  PublishFailure,
  STALE_SNAPSHOT_GRACE_MS,
  blobKey,
  manifestKey,
  mintSnapshotId,
  publishFailureMessage,
  segmentKey,
  type StaleSnapshotEntry,
} from "../domain/snapshot.js";
import { shareIdFromRowId } from "../domain/share-string.js";
import type { KbShareRow } from "../domain/types.js";

const STALE_CLAIM_MS = 15 * 60 * 1000;
const EXECUTE_BATCH_MAX_BYTES = 32 * 1024 * 1024;
const EXECUTE_BATCH_MAX_BLOBS = 500;
const EXECUTE_BATCH_MAX_SEGMENTS = 64;

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
  kbPublish: KbPublishClient;
  getRuntimeCapabilities(agentId: string): Promise<unknown | null>;
  store: Pick<
    ArtifactService,
    "put" | "get" | "delete" | "stat" | "createUploadUrl"
  >;
  ensureReady(agentId: string): Promise<void>;
  limits?: Partial<KbSharePublishLimits>;
  now?: () => Date;
}

export interface KbSharePublishLimits {
  perFileMaxBytes: number;
  totalMaxBytes: number;
  maxFiles: number;
}

const RUNTIME_UNSUPPORTED_MESSAGE =
  "the knowledge base agent's runtime does not support publishing — apply the pending agent update, then refresh the share";
const UPLOAD_VERIFY_FAILED_MESSAGE =
  "publishing could not upload the snapshot — retry shortly";

function extractKbPublishCapability(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as { kbPublish?: unknown }).kbPublish;
  return typeof value === "number" ? value : 0;
}

function chunkBySize<T extends { sizeBytes: number }>(
  items: readonly T[],
  maxBytes: number,
  maxCount: number,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    if (
      current.length > 0 &&
      (bytes + item.sizeBytes > maxBytes || current.length >= maxCount)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += item.sizeBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function chunkByCount<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

interface BlobUploadPlan {
  path: string;
  expectedHash: string;
  sizeBytes: number;
  key: string;
}

interface SegmentBuildPlan {
  bucket: number;
  contentId: string;
  key: string;
  members: SegmentMember[];
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
  const messageLimits = { ...limits, maxWalkDepth: MAX_WALK_DEPTH };

  function validatePlan(
    plan: KbPublishPlan,
    roots: readonly string[],
  ): KbPublishPlanFile[] {
    if (plan.files.length > limits.maxFiles) {
      throw new PublishFailure(
        `the share contains more than ${limits.maxFiles} files — narrow the share roots`,
      );
    }
    const rootSet = new Set(roots);
    const seen = new Set<string>();
    let total = 0;
    for (const file of plan.files) {
      const segments = file.path.split("/");
      if (
        segments.length < 2 ||
        segments.includes("") ||
        segments.includes("..") ||
        segments.includes(".") ||
        !rootSet.has(segments[0]!)
      ) {
        throw new PublishFailure(
          "publish failed: the agent reported an invalid document path",
        );
      }
      if (seen.has(file.path)) {
        throw new PublishFailure(
          "publish failed: the agent reported a duplicate document path",
        );
      }
      seen.add(file.path);
      if (file.sizeBytes > limits.perFileMaxBytes) {
        throw new PublishFailure(
          "publish failed: the agent reported an oversized document",
        );
      }
      total += file.sizeBytes;
    }
    if (total > limits.totalMaxBytes) {
      throw new PublishFailure(
        `the share exceeds ${Math.floor(limits.totalMaxBytes / (1024 * 1024))} MB of text content — narrow the share roots`,
      );
    }
    for (const root of roots) {
      if (!plan.files.some((f) => f.path.startsWith(`${root}/`))) {
        throw new PublishFailure(
          `share root "${root}" contains no publishable text files`,
        );
      }
    }
    return plan.files;
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
        if (manifest.version === 1) {
          if (manifest.searchIndexKey) {
            await deps.store.delete(manifest.searchIndexKey);
          }
        } else if (manifest.search) {
          for (const segment of manifest.search.segments) {
            if (!keysInUse.has(segment.key)) {
              await deps.store.delete(segment.key);
            }
          }
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
      (err.name === "AgentStoppedError" ||
        err.name === "AgentWakeTimeoutError" ||
        err.name === "KbPublishUnreachableError")
    );
  }

  async function mintUploadUrl(
    key: string,
    mintedKeys: Set<string>,
    contentLengthBytes?: number,
  ): Promise<string> {
    const upload = await deps.store.createUploadUrl(
      key,
      contentLengthBytes !== undefined ? { contentLengthBytes } : undefined,
    );
    if (!upload) {
      throw new PublishFailure(
        "object storage is not configured for uploads — publishing is unavailable",
      );
    }
    mintedKeys.add(key);
    return upload.url;
  }

  async function runPublish(claimed: KbShareRow): Promise<void> {
    const { agentId } = claimed;
    const claimedAt = claimed.updatedAt;
    const claimToken = claimed.publishToken ?? "";
    const mintedKeys = new Set<string>();
    try {
      await deps.ensureReady(agentId);

      const capability = extractKbPublishCapability(
        await deps.getRuntimeCapabilities(agentId),
      );
      if (capability === null) {
        await deps.repo
          .releasePublishClaim(agentId, claimToken)
          .catch(() => {});
        return;
      }
      if (capability < 1) {
        throw new PublishFailure(RUNTIME_UNSUPPORTED_MESSAGE);
      }

      const caps: KbPublishCaps = {
        perFileMaxBytes: limits.perFileMaxBytes,
        totalMaxBytes: limits.totalMaxBytes,
        maxFiles: limits.maxFiles,
        maxWalkDepth: MAX_WALK_DEPTH,
      };

      let previous: SnapshotManifest | null = null;
      if (claimed.snapshotManifestKey) {
        const stored = await deps.store.get(claimed.snapshotManifestKey);
        const parsed = stored
          ? parseManifest(stored.content.toString("utf8"))
          : null;
        if (parsed && parsed.version === 2) previous = parsed;
      }

      const planResult = await deps.kbPublish.plan(agentId, {
        roots: [...claimed.roots],
        caps,
      });
      if (!planResult.ok) {
        throw new PublishFailure(
          publishFailureMessage(planResult.error, messageLimits),
        );
      }
      const planFiles = validatePlan(planResult.value, claimed.roots);
      const shareId = shareIdFromRowId(claimed.id);
      const snapshotId = mintSnapshotId();
      const totalSizeBytes = planFiles.reduce((sum, f) => sum + f.sizeBytes, 0);

      const previousHashes = new Set(
        previous?.files.map((f) => f.contentHash) ?? [],
      );
      const blobPlans: BlobUploadPlan[] = [];
      const plannedHashes = new Set<string>();
      for (const file of planFiles) {
        if (previousHashes.has(file.contentHash)) continue;
        if (plannedHashes.has(file.contentHash)) continue;
        plannedHashes.add(file.contentHash);
        const key = blobKey(shareId, file.contentHash);
        if (await deps.store.stat(key)) continue;
        blobPlans.push({
          path: file.path,
          expectedHash: file.contentHash,
          sizeBytes: file.sizeBytes,
          key,
        });
      }

      const previousSearch =
        previous && previous.search &&
        previous.search.formatVersion === INDEX_FORMAT_VERSION
          ? previous.search
          : null;
      const bucketCount = chooseBucketCount(
        totalSizeBytes,
        previousSearch?.bucketCount,
      );
      const membersByBucket = new Map<number, SegmentMember[]>();
      for (const file of planFiles) {
        const bucket = bucketForPath(file.path, bucketCount);
        const members = membersByBucket.get(bucket) ?? [];
        members.push({ path: file.path, contentHash: file.contentHash });
        membersByBucket.set(bucket, members);
      }
      const previousSegments = new Map(
        previousSearch
          ? previousSearch.segments.map((s) => [s.contentId, s] as const)
          : [],
      );
      const manifestSegments: SnapshotSearchSegment[] = [];
      const segmentPlans: SegmentBuildPlan[] = [];
      for (const [bucket, members] of membersByBucket) {
        const contentId = segmentContentId(members, bucketCount);
        const carried = previousSegments.get(contentId);
        if (carried) {
          manifestSegments.push({ ...carried, bucket });
          continue;
        }
        segmentPlans.push({
          bucket,
          contentId,
          key: segmentKey(shareId, contentId),
          members,
        });
      }

      const drifted = new Set<string>();
      const segmentReports = new Map<number, KbPublishSegmentReport>();

      for (const batch of chunkBySize(
        blobPlans,
        EXECUTE_BATCH_MAX_BYTES,
        EXECUTE_BATCH_MAX_BLOBS,
      )) {
        const blobs = [];
        for (const blob of batch) {
          blobs.push({
            path: blob.path,
            expectedHash: blob.expectedHash,
            putUrl: await mintUploadUrl(blob.key, mintedKeys, blob.sizeBytes),
          });
        }
        const result = await deps.kbPublish.execute(agentId, {
          caps,
          bucketCount,
          blobs,
          segments: [],
        });
        if (!result.ok) {
          throw new PublishFailure(
            publishFailureMessage(result.error, messageLimits),
          );
        }
        for (const path of result.value.drifted) drifted.add(path);
      }

      for (const batch of chunkByCount(
        segmentPlans,
        EXECUTE_BATCH_MAX_SEGMENTS,
      )) {
        const segments = [];
        for (const plan of batch) {
          segments.push({
            bucket: plan.bucket,
            members: plan.members.map((m) => ({
              path: m.path,
              expectedHash: m.contentHash,
            })),
            putUrl: await mintUploadUrl(plan.key, mintedKeys),
          });
        }
        const result = await deps.kbPublish.execute(agentId, {
          caps,
          bucketCount,
          blobs: [],
          segments,
        });
        if (!result.ok) {
          throw new PublishFailure(
            publishFailureMessage(result.error, messageLimits),
          );
        }
        for (const path of result.value.drifted) drifted.add(path);
        for (const report of result.value.segments) {
          segmentReports.set(report.bucket, report);
        }
      }

      if (drifted.size > 0) {
        await cleanupKeys(mintedKeys);
        await deps.repo
          .releasePublishClaim(agentId, claimToken)
          .catch(() => {});
        return;
      }

      for (const plan of segmentPlans) {
        const report = segmentReports.get(plan.bucket);
        if (!report) throw new PublishFailure(UPLOAD_VERIFY_FAILED_MESSAGE);
        manifestSegments.push({
          bucket: plan.bucket,
          key: plan.key,
          contentId: plan.contentId,
          docCount: report.docCount,
          sizeBytes: report.sizeBytes,
          degraded: report.degraded,
        });
      }
      manifestSegments.sort((a, b) => a.bucket - b.bucket);

      const blobSizeByKey = new Map(blobPlans.map((b) => [b.key, b.sizeBytes]));
      for (const key of mintedKeys) {
        const stat = await deps.store.stat(key);
        if (!stat) throw new PublishFailure(UPLOAD_VERIFY_FAILED_MESSAGE);
        const expected = blobSizeByKey.get(key);
        if (expected !== undefined && stat.sizeBytes !== expected) {
          throw new PublishFailure(UPLOAD_VERIFY_FAILED_MESSAGE);
        }
      }

      const createdAt = now();
      const files: SnapshotManifestFile[] = planFiles.map((f) => ({
        path: f.path,
        sizeBytes: f.sizeBytes,
        contentHash: f.contentHash,
        key: blobKey(shareId, f.contentHash),
      }));
      const manifest: SnapshotManifest = {
        version: 2,
        snapshotId,
        createdAt: createdAt.toISOString(),
        roots: claimed.roots,
        files,
        documentCount: files.length,
        totalSizeBytes,
        search:
          manifestSegments.length > 0
            ? {
                formatVersion: INDEX_FORMAT_VERSION,
                bucketCount,
                segments: manifestSegments,
              }
            : null,
      };
      const snapshotManifestKey = manifestKey(shareId, snapshotId);
      mintedKeys.add(snapshotManifestKey);
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
        await cleanupKeys(mintedKeys);
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
        for (const segment of manifestSegments) currentKeys.add(segment.key);
        currentKeys.add(snapshotManifestKey);
        await gcStaleSnapshots(claimed.id, staleSnapshots, currentKeys);
      } catch (err) {
        process.stderr.write(
          `[kb-share-publish] snapshot gc failed for ${agentId}: ${err}\n`,
        );
      }
    } catch (err) {
      await cleanupKeys(mintedKeys);
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
