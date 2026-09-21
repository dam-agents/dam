import { createReadStream } from "node:fs";

export async function readTextWithin(
  res: Response,
  maxBytes: number,
): Promise<string | null> {
  const body = await readBytesWithin(res, maxBytes);
  return body === null ? null : body.toString("utf8");
}

export async function readBytesWithin(
  res: Response,
  maxBytes: number,
): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    void res.body?.cancel();
    return null;
  }

  const body = res.body;
  if (!body) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export const OVER_BUDGET = Symbol("over-budget");

export async function readFileWithin(
  fullPath: string,
  maxBytes: number,
): Promise<string | null | typeof OVER_BUDGET> {
  const chunks: Buffer[] = [];
  let total = 0;
  const stream = createReadStream(fullPath);
  try {
    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      total += buf.byteLength;
      if (total > maxBytes) return OVER_BUDGET;
      chunks.push(buf);
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR")
      return null;
    throw err;
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks).toString("utf8");
}
