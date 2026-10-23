import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

const RETRY_DELAY_MS = 1_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: PUTs one file to a server-minted presigned URL,
 * streamed from disk so a large output never sits in memory. The body carries
 * its exact Content-Length, because an S3 presigned PUT refuses a chunked
 * body. Agent pods run with NODE_USE_ENV_PROXY=1, so fetch rides the paired
 * gateway like every other upload. One retry on a network error or a 5xx; a
 * 4xx is final. Returns null on success, else why it failed.
 */
export async function uploadFile(
  url: string,
  path: string,
  sizeBytes: number,
  deadline: Date,
): Promise<string | null> {
  let failure = "unknown";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "PUT",
        body: Readable.toWeb(createReadStream(path)) as ReadableStream,
        headers: { "content-length": String(sizeBytes) },
        duplex: "half",
        signal: AbortSignal.timeout(
          Math.max(60_000, deadline.getTime() - Date.now()),
        ),
      } as RequestInit);
      await res.text().catch(() => "");
      if (res.ok) return null;
      failure = `status ${res.status}`;
      if (res.status < 500) return failure;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  return failure;
}
