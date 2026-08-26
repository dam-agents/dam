import { readFile, stat } from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";

/**
 * UNIT_BOUNDARY_DESCRIPTION: reads one candidate document for publishing,
 * mirroring the filters the serving contract promises consumers — text only
 * (magic-byte and NUL sniff reject binaries regardless of extension) and a
 * hard per-file byte cap; anything else returns null and is excluded rather
 * than failing the publish.
 */
export async function readTextFile(
  abs: string,
  maxBytes: number,
): Promise<Buffer | null> {
  let buf: Buffer;
  try {
    const st = await stat(abs);
    if (!st.isFile() || st.size > maxBytes) return null;
    buf = await readFile(abs);
  } catch {
    return null;
  }
  if (buf.byteLength > maxBytes) return null;
  if (buf.includes(0)) return null;
  const detected = await fileTypeFromBuffer(buf);
  if (detected) return null;
  return buf;
}
