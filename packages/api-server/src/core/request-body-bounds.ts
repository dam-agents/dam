import { bodyLimit } from "hono/body-limit";

export const MAX_USER_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
export const MAX_AGENT_REQUEST_BODY_BYTES = 128 * 1024 * 1024;
export const MAX_TRPC_BATCH_SIZE = 1_000;

// UNIT_BOUNDARY_DESCRIPTION: answers 413 to a request body over `maxSize` bytes before any handler buffers or parses it. A declared Content-Length over the limit is refused unread; a chunked body is read only until it passes the limit. The user limit sits above the largest user tRPC input (`skills.createLocal`, 5 MB of text, which JSON escaping can grow to 30 MB); the agent limit sits above the largest agent input (a kb-publish plan of 20 000 files with 4 096-character paths, about 85 MB).
export function limitRequestBody(maxSize: number) {
  return bodyLimit({
    maxSize,
    onError: (c) =>
      c.json({ error: `request body exceeds ${maxSize} bytes` }, 413),
  });
}
