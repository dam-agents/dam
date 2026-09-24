import {
  ARTIFACT_API_MAX_BODY_BYTES,
  ARTIFACT_API_TIMEOUT_MS,
  type ArtifactApiRequestInput,
  type ArtifactApiRequestResult,
  type ArtifactApiService,
} from "agent-runtime-api";

type ReadOutcome =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "response-too-large" };

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<ReadOutcome> {
  if (!body) return { ok: true, bytes: new Uint8Array() };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return { ok: false, reason: "response-too-large" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the relay from the harness port to the Agent's
 * Artifact API on 127.0.0.1 at the Artifact API Port. The host is fixed and
 * the page's path is only appended to it, so a request can never reach
 * another host. Only content-type is sent, redirects are not followed, and
 * the 30 s timeout and 1 MiB response cap apply. Any HTTP status the server
 * gives is a success; nothing listening, a timeout and a too-large body come
 * back as failure reasons, never as thrown errors.
 */
export function composeArtifactApi(opts: {
  port: number;
  fetch: typeof globalThis.fetch;
}): ArtifactApiService {
  const origin = `http://127.0.0.1:${opts.port}`;

  async function request(
    input: ArtifactApiRequestInput,
  ): Promise<ArtifactApiRequestResult> {
    const contentType =
      input.contentType ??
      (input.body !== undefined ? "application/json" : undefined);
    try {
      const response = await opts.fetch(`${origin}${input.path}`, {
        method: input.method,
        headers: contentType ? { "content-type": contentType } : {},
        body: input.body,
        redirect: "manual",
        signal: AbortSignal.timeout(ARTIFACT_API_TIMEOUT_MS),
      });
      const read = await readCapped(response.body, ARTIFACT_API_MAX_BODY_BYTES);
      if (!read.ok) return read;
      return {
        ok: true,
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: new TextDecoder().decode(read.bytes),
      };
    } catch (error) {
      if (isTimeout(error)) return { ok: false, reason: "timeout" };
      return { ok: false, reason: "app-not-listening" };
    }
  }

  return { request };
}
