import { join } from "node:path";
import { setImmediate as yieldToLoop } from "node:timers/promises";

import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";

import { err, ok, type Result } from "agent-runtime-api";
import type {
  KbPublishExecuteInput,
  KbPublishExecuteReport,
  KbPublishSegmentReport,
  KbPublishUploadedBlob,
} from "agent-runtime-api";
import {
  buildSegment,
  contentHash,
  type KbPublishFailure,
  type SegmentSourceFile,
} from "agent-runtime-api/kb-snapshot";

import { readTextFile } from "./read-text.js";

const UPLOAD_RETRY_DELAY_MS = 250;

function safeAbs(workDir: string, rel: string): string | null {
  if (rel.startsWith("/") || rel.split("/").includes("..")) return null;
  return join(workDir, rel);
}

function pickProxy(): string | undefined {
  return (
    process.env["HTTPS_PROXY"] ??
    process.env["https_proxy"] ??
    process.env["HTTP_PROXY"] ??
    process.env["http_proxy"] ??
    undefined
  );
}

async function putObject(
  url: string,
  body: Buffer | string,
  contentType: string,
  dispatcher: Dispatcher | undefined,
): Promise<string | null> {
  let lastFailure = "unknown";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await undiciFetch(url, {
        method: "PUT",
        body,
        headers: { "content-type": contentType },
        ...(dispatcher ? { dispatcher } : {}),
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

export async function executeBatch(opts: {
  workDir: string;
  input: KbPublishExecuteInput;
  log: (msg: string) => void;
}): Promise<Result<KbPublishExecuteReport, KbPublishFailure>> {
  const proxy = pickProxy();
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  try {
    const drifted = new Set<string>();
    const uploadedBlobs: KbPublishUploadedBlob[] = [];
    const textByPath = new Map<string, string>();

    const readVerified = async (
      path: string,
      expectedHash: string,
    ): Promise<Buffer | null> => {
      const abs = safeAbs(opts.workDir, path);
      if (!abs) return null;
      const buf = await readTextFile(abs, opts.input.caps.perFileMaxBytes);
      if (!buf || contentHash(buf) !== expectedHash) return null;
      return buf;
    };

    for (const blob of opts.input.blobs) {
      const buf = await readVerified(blob.path, blob.expectedHash);
      if (!buf) {
        drifted.add(blob.path);
        continue;
      }
      const failure = await putObject(
        blob.putUrl,
        buf,
        "text/plain; charset=utf-8",
        dispatcher,
      );
      if (failure !== null) {
        return err({ code: "upload-failed", detail: `${blob.path}: ${failure}` });
      }
      uploadedBlobs.push({
        path: blob.path,
        contentHash: blob.expectedHash,
        sizeBytes: buf.byteLength,
      });
      textByPath.set(blob.path, buf.toString("utf8"));
      await yieldToLoop();
    }

    const segments: KbPublishSegmentReport[] = [];
    for (const spec of opts.input.segments) {
      const sources: SegmentSourceFile[] = [];
      let segmentDrifted = false;
      for (const member of spec.members) {
        const cached = textByPath.get(member.path);
        if (cached !== undefined) {
          sources.push({ path: member.path, text: cached });
          continue;
        }
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
      const failure = await putObject(
        spec.putUrl,
        body,
        "application/json",
        dispatcher,
      );
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
  } finally {
    await (dispatcher as ProxyAgent | undefined)?.close().catch(() => {});
  }
}
