import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";
import {
  contentHashSchema,
  type KbPublishCompleteReport,
  type KbPublishCompleteResult,
  type KbPublishGate,
  type KbPublishInventoryFile,
  type KbPublishRequestInput,
  type KbPublishRequestResult,
  type KbPublishWorkOrder,
} from "api-server-api";
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
  type KbPublishFailure,
  type SegmentMember,
  type SnapshotManifest,
  type SnapshotManifestFile,
  type SnapshotSearchSegment,
} from "agent-runtime-api/kb-snapshot";

import type { ArtifactService } from "../../artifacts/services/artifact-service.js";
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

export const STALE_CLAIM_MS = 15 * 60 * 1000;

const RUNTIME_UNSUPPORTED_MESSAGE =
  "the knowledge base agent's runtime does not support publishing — apply the pending agent update, then refresh the share";
const UPLOAD_VERIFY_FAILED_MESSAGE =
  "publishing could not upload the snapshot — retry shortly";

/**
 * UNIT_BOUNDARY_DESCRIPTION: thrown when a plan references roots the claim
 * does not hold — the signature of a pod that planned before a roots change
 * synced to it, not of a hostile plan. It resolves as busy (release the
 * claim, let the pod retry with synced roots) instead of recording an
 * owner-visible failure for a self-healing race.
 */
class StalePlanError extends Error {}

export { RUNTIME_UNSUPPORTED_MESSAGE };

export interface KbSharePublishGate extends KbPublishGate {
  purgeShareObjects(row: KbShareRow): Promise<void>;
}

export interface KbSharePublishGateDeps {
  repo: {
    claimPublish(
      agentId: string,
      opts: { staleClaimMs: number },
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
    clearSnapshotPointer(rowId: string): Promise<void>;
  };
  findActiveByAgent(agentId: string): Promise<KbShareRow | null>;
  store: Pick<
    ArtifactService,
    "put" | "get" | "delete" | "stat" | "createUploadUrl"
  >;
  limits?: Partial<KbSharePublishLimits>;
  now?: () => Date;
}

export interface KbSharePublishLimits {
  perFileMaxBytes: number;
  totalMaxBytes: number;
  maxFiles: number;
}

interface SegmentBuildPlan {
  bucket: number;
  contentId: string;
  key: string;
  members: SegmentMember[];
}

interface PendingPublish {
  agentId: string;
  owner: string;
  roots: readonly string[];
  ticket: string;
  claimedAt: Date;
  createdAtMs: number;
  snapshotId: string;
  shareId: string;
  planFiles: KbPublishInventoryFile[];
  totalSizeBytes: number;
  bucketCount: number;
  carriedSegments: SnapshotSearchSegment[];
  segmentPlans: SegmentBuildPlan[];
  blobSizeByKey: Map<string, number>;
  adoptedSizeByKey: Map<string, number>;
  mintedKeys: Set<string>;
  previousSnapshotId: string | null;
  previousManifestKey: string | null;
  previousStale: readonly StaleSnapshotEntry[];
}

function fromWireFailure(wire: {
  code: string;
  root?: string;
  detail?: string;
}): KbPublishFailure {
  switch (wire.code) {
    case "root-missing":
      return { code: "root-missing", root: wire.root ?? "" };
    case "too-deep":
    case "too-many-files":
    case "total-too-large":
      return { code: wire.code };
    default:
      return { code: "upload-failed", detail: wire.detail ?? wire.code };
  }
}

export function createKbSharePublishGate(
  deps: KbSharePublishGateDeps,
): KbSharePublishGate {
  const now = deps.now ?? (() => new Date());
  const limits: KbSharePublishLimits = {
    perFileMaxBytes: deps.limits?.perFileMaxBytes ?? PER_FILE_MAX_BYTES,
    totalMaxBytes: deps.limits?.totalMaxBytes ?? TOTAL_MAX_BYTES,
    maxFiles: deps.limits?.maxFiles ?? MAX_FILES,
  };
  const messageLimits = { ...limits, maxWalkDepth: MAX_WALK_DEPTH };
  const pending = new Map<string, PendingPublish>();

  function validatePlan(
    files: readonly KbPublishInventoryFile[],
    roots: readonly string[],
  ): KbPublishInventoryFile[] {
    if (files.length > limits.maxFiles) {
      throw new PublishFailure(
        `the share contains more than ${limits.maxFiles} files — narrow the share roots`,
      );
    }
    const rootSet = new Set(roots);
    const seen = new Set<string>();
    let total = 0;
    for (const file of files) {
      const segments = file.path.split("/");
      if (
        segments.length < 2 ||
        segments.includes("") ||
        segments.includes("..") ||
        segments.includes(".")
      ) {
        throw new PublishFailure(
          "publish failed: the agent reported an invalid document path",
        );
      }
      if (!rootSet.has(segments[0]!)) {
        throw new StalePlanError(
          `plan references unclaimed root "${segments[0]!}"`,
        );
      }
      if (!contentHashSchema.safeParse(file.contentHash).success) {
        throw new PublishFailure(
          "publish failed: the agent reported an invalid content hash",
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
      if (!files.some((f) => f.path.startsWith(`${root}/`))) {
        throw new PublishFailure(
          `share root "${root}" contains no publishable text files`,
        );
      }
    }
    return [...files];
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: reclaims snapshots past the grace hold and
   * returns the surviving ledger for the caller's token-guarded commit to
   * write — the ledger is never written blind, so a slow pass cannot clobber
   * a newer publish's list. Deleting is gated on still holding the claim
   * (re-read immediately before the first delete): a publisher that lost it
   * may be racing a successor that already adopted the same content-addressed
   * keys, and skipping the sweep only defers it to the next publish.
   * Reachability spans every manifest a reader can still hold — the current
   * snapshot plus all in-grace entries. The in-use set is built fully before
   * the first delete, and an in-grace manifest that exists but does not parse
   * (e.g. a future format during a rolling deploy) aborts the pass with
   * nothing removed; a manifest object that is gone protects nothing, because
   * no reader can load it. Malformed grace stamps fail safe: the entry is
   * kept, never expired.
   */
  async function reapStaleSnapshots(opts: {
    agentId: string;
    ticket: string;
    stale: readonly StaleSnapshotEntry[];
    currentKeys: ReadonlySet<string>;
  }): Promise<readonly StaleSnapshotEntry[]> {
    const keep: StaleSnapshotEntry[] = [];
    const expired: StaleSnapshotEntry[] = [];
    const nowMs = now().getTime();
    for (const entry of opts.stale) {
      const ageMs = nowMs - Date.parse(entry.replacedAt);
      const expiredNow = ageMs >= STALE_SNAPSHOT_GRACE_MS;
      (expiredNow ? expired : keep).push(entry);
    }
    if (expired.length === 0) return opts.stale;
    if (!(await stillHoldsClaim(opts.agentId, opts.ticket))) return opts.stale;
    const keysInUse = new Set(opts.currentKeys);
    for (const entry of keep) {
      await collectManifestKeys(entry.manifestKey, keysInUse);
    }
    for (const entry of expired) {
      await deleteSnapshotObjects(entry.manifestKey, keysInUse);
    }
    return keep;
  }

  async function stillHoldsClaim(
    agentId: string,
    ticket: string,
  ): Promise<boolean> {
    const row = await deps.findActiveByAgent(agentId);
    return (
      row !== null &&
      row.publishState === "publishing" &&
      row.publishToken === ticket
    );
  }

  function reapStaleSnapshotsSafely(opts: {
    agentId: string;
    ticket: string;
    stale: readonly StaleSnapshotEntry[];
    currentKeys: ReadonlySet<string>;
  }): Promise<readonly StaleSnapshotEntry[]> {
    return reapStaleSnapshots(opts).catch((err: unknown) => {
      process.stderr.write(
        `[kb-share-publish] snapshot gc failed for ${opts.agentId}: ${err}\n`,
      );
      return opts.stale;
    });
  }

  async function collectManifestKeys(
    snapshotManifestKey: string,
    into: Set<string>,
  ): Promise<void> {
    into.add(snapshotManifestKey);
    const stored = await deps.store.get(snapshotManifestKey);
    if (!stored) return;
    const manifest = parseManifest(stored.content.toString("utf8"));
    if (!manifest) {
      throw new Error(
        `in-grace manifest ${snapshotManifestKey} is unreadable — aborting gc rather than deleting keys it may reference`,
      );
    }
    for (const file of manifest.files) into.add(file.key);
    if (manifest.version === 1) {
      if (manifest.searchIndexKey) into.add(manifest.searchIndexKey);
    } else if (manifest.search) {
      for (const segment of manifest.search.segments) into.add(segment.key);
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
          if (
            manifest.searchIndexKey &&
            !keysInUse.has(manifest.searchIndexKey)
          ) {
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
    if (!keysInUse.has(snapshotManifestKey)) {
      await deps.store.delete(snapshotManifestKey);
    }
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a failed or lost publish attempt may delete
   * only its own manifest — blob and segment keys are content-addressed and
   * shared across attempts and snapshots (a concurrent taken-over publish
   * adopts any object that already exists), so a loser deleting them would
   * break a winner's live manifest. Objects a manifest references are
   * reclaimed by the stale-snapshot GC or a whole-share purge; uploads from
   * an attempt that never commits are an accepted bounded leak — the store
   * has no enumeration API to sweep them, and a later publish of identical
   * content adopts them instead of re-uploading.
   */
  async function dropAttemptManifest(entry: {
    shareId: string;
    snapshotId: string;
  }): Promise<void> {
    await deps.store
      .delete(manifestKey(entry.shareId, entry.snapshotId))
      .catch(() => {});
  }

  async function mintUploadUrl(
    key: string,
    mintedKeys: Set<string>,
  ): Promise<string> {
    const upload = await deps.store.createUploadUrl(key);
    if (!upload) {
      throw new PublishFailure(
        "object storage is not configured for uploads — publishing is unavailable",
      );
    }
    mintedKeys.add(key);
    return upload.url;
  }

  function reportFailure(
    row: Pick<KbShareRow, "agentId" | "owner">,
    ticket: string,
    reason: string,
  ): void {
    void deps.repo
      .finishPublishFailure(row.agentId, reason, ticket)
      .catch(() => {});
    securityLog("warn", "kb_share.publish_failed", {
      category: "resource",
      actor: row.owner,
      actorKind: "user",
      agentId: row.agentId,
      result: "failure",
      reason,
    });
    emit({
      type: EventType.KbSharePublishFailed,
      agentId: row.agentId,
      ownerSub: row.owner,
      reason,
    });
  }

  function reapAbandonedPending(): void {
    const cutoff = now().getTime() - STALE_CLAIM_MS;
    for (const [ticket, entry] of pending) {
      if (entry.createdAtMs >= cutoff) continue;
      pending.delete(ticket);
      void deps.repo.releasePublishClaim(entry.agentId, ticket).catch(() => {});
    }
  }

  async function request(
    agentId: string,
    input: KbPublishRequestInput,
  ): Promise<KbPublishRequestResult> {
    reapAbandonedPending();
    const row = await deps.findActiveByAgent(agentId);
    if (!row) return { outcome: "not-shared" };
    const claimed = await deps.repo.claimPublish(agentId, {
      staleClaimMs: STALE_CLAIM_MS,
    });
    if (!claimed || !claimed.publishToken) return { outcome: "busy" };
    const ticket = claimed.publishToken;
    const claimedAt = claimed.updatedAt;
    const mintedKeys = new Set<string>();

    try {
      if (input.kind === "failure") {
        reportFailure(
          claimed,
          ticket,
          publishFailureMessage(fromWireFailure(input.failure), messageLimits),
        );
        return { outcome: "rejected" };
      }

      const planFiles = validatePlan(input.files, claimed.roots);
      const shareId = shareIdFromRowId(claimed.id);
      const totalSizeBytes = planFiles.reduce((sum, f) => sum + f.sizeBytes, 0);

      let previous: SnapshotManifest | null = null;
      if (claimed.snapshotManifestKey) {
        const stored = await deps.store.get(claimed.snapshotManifestKey);
        const parsed = stored
          ? parseManifest(stored.content.toString("utf8"))
          : null;
        if (parsed && parsed.version === 2) previous = parsed;
      }
      const previousHashes = new Set(
        previous?.files.map((f) => f.contentHash) ?? [],
      );
      const previousFilesByPath = new Map(
        previous?.files.map((f) => [f.path, f.contentHash] as const) ?? [],
      );
      const previousSearch =
        previous &&
        previous.search &&
        previous.search.formatVersion === INDEX_FORMAT_VERSION
          ? previous.search
          : null;

      const blobPlans: {
        path: string;
        expectedHash: string;
        sizeBytes: number;
        key: string;
      }[] = [];
      const plannedHashes = new Set<string>();
      const adoptedSizeByKey = new Map<string, number>();
      for (const file of planFiles) {
        if (previousHashes.has(file.contentHash)) continue;
        if (plannedHashes.has(file.contentHash)) continue;
        plannedHashes.add(file.contentHash);
        const key = blobKey(shareId, file.contentHash);
        const existing = await deps.store.stat(key);
        if (existing && existing.sizeBytes === file.sizeBytes) {
          adoptedSizeByKey.set(key, file.sizeBytes);
          continue;
        }
        blobPlans.push({
          path: file.path,
          expectedHash: file.contentHash,
          sizeBytes: file.sizeBytes,
          key,
        });
      }

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
      const carriedSegments: SnapshotSearchSegment[] = [];
      const segmentPlans: SegmentBuildPlan[] = [];
      for (const [bucket, members] of membersByBucket) {
        const contentId = segmentContentId(members, bucketCount);
        const carried = previousSegments.get(contentId);
        if (carried && (await deps.store.stat(carried.key))) {
          carriedSegments.push({ ...carried, bucket });
          continue;
        }
        segmentPlans.push({
          bucket,
          contentId,
          key: segmentKey(shareId, contentId),
          members,
        });
      }

      if (
        previous !== null &&
        claimed.snapshotId !== null &&
        claimed.snapshotManifestKey !== null &&
        blobPlans.length === 0 &&
        segmentPlans.length === 0 &&
        previous.files.length === planFiles.length &&
        planFiles.every(
          (f) => previousFilesByPath.get(f.path) === f.contentHash,
        ) &&
        previous.roots.length === claimed.roots.length &&
        previous.roots.every((root, i) => root === claimed.roots[i])
      ) {
        const currentKeys = new Set(previous.files.map((f) => f.key));
        if (previous.search) {
          for (const segment of previous.search.segments) {
            currentKeys.add(segment.key);
          }
        }
        currentKeys.add(claimed.snapshotManifestKey);
        const staleSnapshots = await reapStaleSnapshotsSafely({
          agentId,
          ticket,
          stale: claimed.staleSnapshots,
          currentKeys,
        });
        const won = await deps.repo.finishPublishSuccess(
          agentId,
          {
            snapshotId: claimed.snapshotId,
            snapshotManifestKey: claimed.snapshotManifestKey,
            snapshotCreatedAt: claimed.snapshotCreatedAt ?? now(),
            documentCount: planFiles.length,
            totalSizeBytes,
            staleSnapshots,
          },
          ticket,
          claimedAt,
        );
        if (won) {
          emit({
            type: EventType.KbSharePublished,
            agentId,
            ownerSub: claimed.owner,
          });
        }
        return { outcome: "up-to-date" };
      }

      const order: KbPublishWorkOrder = {
        ticket,
        caps: {
          perFileMaxBytes: limits.perFileMaxBytes,
          totalMaxBytes: limits.totalMaxBytes,
          maxFiles: limits.maxFiles,
          maxWalkDepth: MAX_WALK_DEPTH,
        },
        bucketCount,
        blobs: [],
        segments: [],
      };
      for (const blob of blobPlans) {
        order.blobs.push({
          path: blob.path,
          expectedHash: blob.expectedHash,
          putUrl: await mintUploadUrl(blob.key, mintedKeys),
        });
      }
      for (const plan of segmentPlans) {
        order.segments.push({
          bucket: plan.bucket,
          members: plan.members.map((m) => ({
            path: m.path,
            expectedHash: m.contentHash,
          })),
          putUrl: await mintUploadUrl(plan.key, mintedKeys),
        });
      }

      pending.set(ticket, {
        agentId,
        owner: claimed.owner,
        roots: claimed.roots,
        ticket,
        claimedAt,
        createdAtMs: now().getTime(),
        snapshotId: mintSnapshotId(),
        shareId,
        planFiles,
        totalSizeBytes,
        bucketCount,
        carriedSegments,
        segmentPlans,
        blobSizeByKey: new Map(blobPlans.map((b) => [b.key, b.sizeBytes])),
        adoptedSizeByKey,
        mintedKeys,
        previousSnapshotId: claimed.snapshotId,
        previousManifestKey: claimed.snapshotManifestKey,
        previousStale: claimed.staleSnapshots,
      });
      return { outcome: "work", order };
    } catch (err) {
      if (err instanceof StalePlanError) {
        await deps.repo.releasePublishClaim(agentId, ticket).catch(() => {});
        return { outcome: "busy" };
      }
      const reason =
        err instanceof PublishFailure
          ? err.message
          : `publish failed: ${err instanceof Error ? err.message : String(err)}`;
      reportFailure(claimed, ticket, reason);
      return { outcome: "rejected" };
    }
  }

  interface PreparedSnapshot {
    files: SnapshotManifestFile[];
    manifestSegments: SnapshotSearchSegment[];
    snapshotManifestKey: string;
    staleSnapshots: StaleSnapshotEntry[];
    createdAt: Date;
  }

  async function prepareSnapshot(
    entry: PendingPublish,
    report: KbPublishCompleteReport,
  ): Promise<PreparedSnapshot> {
    const manifestSegments: SnapshotSearchSegment[] = [
      ...entry.carriedSegments,
    ];
    const reportedByBucket = new Map(
      report.segments.map((s) => [s.bucket, s] as const),
    );
    for (const plan of entry.segmentPlans) {
      const reported = reportedByBucket.get(plan.bucket);
      if (!reported) throw new PublishFailure(UPLOAD_VERIFY_FAILED_MESSAGE);
      manifestSegments.push({
        bucket: plan.bucket,
        key: plan.key,
        contentId: plan.contentId,
        docCount: reported.docCount,
        sizeBytes: reported.sizeBytes,
        degraded: reported.degraded,
      });
    }
    manifestSegments.sort((a, b) => a.bucket - b.bucket);

    const expectedSizeByKey = new Map([
      ...entry.blobSizeByKey,
      ...entry.adoptedSizeByKey,
    ]);
    for (const plan of entry.segmentPlans) {
      const reported = reportedByBucket.get(plan.bucket);
      if (reported) expectedSizeByKey.set(plan.key, reported.sizeBytes);
    }
    for (const key of [...entry.mintedKeys, ...entry.adoptedSizeByKey.keys()]) {
      const stat = await deps.store.stat(key);
      if (!stat) throw new PublishFailure(UPLOAD_VERIFY_FAILED_MESSAGE);
      const expected = expectedSizeByKey.get(key);
      if (expected !== undefined && stat.sizeBytes !== expected) {
        throw new PublishFailure(UPLOAD_VERIFY_FAILED_MESSAGE);
      }
    }

    const createdAt = now();
    const files: SnapshotManifestFile[] = entry.planFiles.map((f) => ({
      path: f.path,
      sizeBytes: f.sizeBytes,
      contentHash: f.contentHash,
      key: blobKey(entry.shareId, f.contentHash),
    }));
    const manifest: SnapshotManifest = {
      version: 2,
      snapshotId: entry.snapshotId,
      createdAt: createdAt.toISOString(),
      roots: entry.roots,
      files,
      documentCount: files.length,
      totalSizeBytes: entry.totalSizeBytes,
      search:
        manifestSegments.length > 0
          ? {
              formatVersion: INDEX_FORMAT_VERSION,
              bucketCount: entry.bucketCount,
              segments: manifestSegments,
            }
          : null,
    };
    const snapshotManifestKey = manifestKey(entry.shareId, entry.snapshotId);
    await deps.store.put({
      key: snapshotManifestKey,
      content: Buffer.from(JSON.stringify(manifest), "utf8"),
      contentType: "application/json",
    });
    const staleSnapshots: StaleSnapshotEntry[] =
      entry.previousSnapshotId && entry.previousManifestKey
        ? [
            ...entry.previousStale,
            {
              snapshotId: entry.previousSnapshotId,
              manifestKey: entry.previousManifestKey,
              replacedAt: createdAt.toISOString(),
            },
          ]
        : [...entry.previousStale];
    return {
      files,
      manifestSegments,
      snapshotManifestKey,
      staleSnapshots,
      createdAt,
    };
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: completion is three phases with distinct
   * failure semantics — prepare (verify every object the manifest will
   * reference, write the attempt's manifest; a failure is pre-commit: drop
   * that manifest and record the failure), commit (reap expired snapshots
   * while the claim is still held, then swap the pointer and the surviving
   * ledger in one token-guarded update; a thrown swap leaves the outcome
   * unknown, so delete nothing and let the pod retry — the next request
   * short-circuits if it landed), and post-commit bookkeeping (log, emit),
   * which may fail loudly but must never un-publish what the row now points
   * at.
   */
  async function complete(
    agentId: string,
    ticket: string,
    report: KbPublishCompleteReport,
  ): Promise<KbPublishCompleteResult> {
    const entry = pending.get(ticket);
    if (!entry || entry.agentId !== agentId) {
      await deps.repo.releasePublishClaim(agentId, ticket).catch(() => {});
      return { outcome: "retry" };
    }
    pending.delete(ticket);

    if (report.aborted === true || report.drifted.length > 0) {
      await deps.repo.releasePublishClaim(agentId, ticket).catch(() => {});
      return { outcome: "retry" };
    }

    let prepared: PreparedSnapshot;
    try {
      prepared = await prepareSnapshot(entry, report);
    } catch (err) {
      await dropAttemptManifest(entry);
      const reason =
        err instanceof PublishFailure
          ? err.message
          : `publish failed: ${err instanceof Error ? err.message : String(err)}`;
      reportFailure(entry, ticket, reason);
      return { outcome: "failed" };
    }

    const currentKeys = new Set(prepared.files.map((f) => f.key));
    for (const segment of prepared.manifestSegments) {
      currentKeys.add(segment.key);
    }
    currentKeys.add(prepared.snapshotManifestKey);
    const staleSnapshots = await reapStaleSnapshotsSafely({
      agentId,
      ticket,
      stale: prepared.staleSnapshots,
      currentKeys,
    });

    let won: boolean;
    try {
      won = await deps.repo.finishPublishSuccess(
        agentId,
        {
          snapshotId: entry.snapshotId,
          snapshotManifestKey: prepared.snapshotManifestKey,
          snapshotCreatedAt: prepared.createdAt,
          documentCount: prepared.files.length,
          totalSizeBytes: entry.totalSizeBytes,
          staleSnapshots,
        },
        ticket,
        entry.claimedAt,
      );
    } catch (err) {
      process.stderr.write(
        `[kb-share-publish] commit outcome unknown for ${agentId}: ${err}\n`,
      );
      return { outcome: "retry" };
    }
    if (!won) {
      await dropAttemptManifest(entry);
      return { outcome: "retry" };
    }

    try {
      securityLog("info", "kb_share.published", {
        category: "resource",
        actor: entry.owner,
        actorKind: "user",
        agentId,
        result: "success",
        detail: {
          snapshotId: entry.snapshotId,
          documentCount: prepared.files.length,
          totalSizeBytes: entry.totalSizeBytes,
        },
      });
      emit({
        type: EventType.KbSharePublished,
        agentId,
        ownerSub: entry.owner,
      });
    } catch (err) {
      process.stderr.write(
        `[kb-share-publish] post-commit hooks failed for ${agentId}: ${err}\n`,
      );
    }
    return { outcome: "committed" };
  }

  return {
    request,
    complete,

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
