import { join } from "node:path";
import { setImmediate as yieldToLoop } from "node:timers/promises";

import { err, ok, type Result } from "agent-runtime-api";
import type {
  KbPublishExecuteReport,
  KbPublishSegmentReport,
  KbPublishUploadedBlob,
} from "agent-runtime-api";
import type { KbPublishWorkOrder } from "api-server-api";
import {
  buildSegment,
  contentHash,
  type KbPublishFailure,
  type SegmentSourceFile,
} from "agent-runtime-api/kb-snapshot";

import { readTextFile } from "./read-text.js";

const UPLOAD_RETRY_DELAY_MS = 250;

export type KbPublishWork = Omit<KbPublishWorkOrder, "ticket">;

function safeAbs(workDir: string, rel: string): string | null {
  if (rel.startsWith("/") || rel.split("/").includes("..")) return null;
  return join(workDir, rel);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: uploads one object to a server-minted presigned
 * URL using the global fetch — agent pods run with NODE_USE_ENV_PROXY=1, so
 * fetch already rides HTTP(S)_PROXY through the paired gateway, the pod's
 * only network exit. One retry on network errors and 5xx; a 4xx is final
 * (typically an expired link — the server re-mints on the next request).
 */
async function putObject(
  url: string,
  body: Buffer | string,
  contentType: string,
): Promise<string | null> {
  let lastFailure = "unknown";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "PUT",
        body,
        headers: { "content-type": contentType },
      });
      await res.text().catch(() => "");
      if (res.ok) return null;
      lastFailure = `status ${res.status}`;
      if (res.status < 500) return lastFailure;
    } catch (e) {
      lastFailure = e instanceof Error ? e.message : String(e);
    }
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_RETRY_DELAY_MS));
  }
  return lastFailure;
}

export async function executeWork(opts: {
  workDir: string;
  work: KbPublishWork;
  log: (msg: string) => void;
}): Promise<Result<KbPublishExecuteReport, KbPublishFailure>> {
  const { work } = opts;
  const drifted = new Set<string>();
  const uploadedBlobs: KbPublishUploadedBlob[] = [];

  const readVerified = async (
    path: string,
    expectedHash: string,
  ): Promise<Buffer | null> => {
    const abs = safeAbs(opts.workDir, path);
    if (!abs) return null;
    const buf = await readTextFile(abs, work.caps.perFileMaxBytes);
    if (!buf || contentHash(buf) !== expectedHash) return null;
    return buf;
  };

  for (const blob of work.blobs) {
    const buf = await readVerified(blob.path, blob.expectedHash);
    if (!buf) {
      drifted.add(blob.path);
      continue;
    }
    const failure = await putObject(
      blob.putUrl,
      buf,
      "text/plain; charset=utf-8",
    );
    if (failure !== null) {
      return err({ code: "upload-failed", detail: `${blob.path}: ${failure}` });
    }
    uploadedBlobs.push({
      path: blob.path,
      contentHash: blob.expectedHash,
      sizeBytes: buf.byteLength,
    });
    await yieldToLoop();
  }

  const segments: KbPublishSegmentReport[] = [];
  for (const spec of work.segments) {
    const sources: SegmentSourceFile[] = [];
    let segmentDrifted = false;
    for (const member of spec.members) {
      const buf = await readVerified(member.path, member.expectedHash);
      if (!buf) {
        drifted.add(member.path);
        segmentDrifted = true;
        continue;
      }
      sources.push({ path: member.path, text: buf.toString("utf8") });
      await yieldToLoop();
    }
    if (segmentDrifted) continue;
    const built = buildSegment(sources);
    const body = JSON.stringify(built);
    const failure = await putObject(spec.putUrl, body, "application/json");
    if (failure !== null) {
      return err({
        code: "upload-failed",
        detail: `segment ${spec.bucket}: ${failure}`,
      });
    }
    segments.push({
      bucket: spec.bucket,
      docCount: built.docs.length,
      sizeBytes: Buffer.byteLength(body),
      degraded: built.degraded,
    });
    await yieldToLoop();
  }
  return ok({ uploadedBlobs, segments, drifted: [...drifted].sort() });
}
