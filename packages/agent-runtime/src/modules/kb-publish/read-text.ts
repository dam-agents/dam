import { open } from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";

/**
 * UNIT_BOUNDARY_DESCRIPTION: reads one candidate document for publishing,
 * mirroring the filters the serving contract promises consumers — text only
 * (magic-byte and NUL sniff reject binaries regardless of extension) and a
 * hard per-file byte cap; anything else returns null and is excluded rather
 * than failing the publish. Stat and read go through one file handle so the
 * size check and the bytes come from the same inode, and the byte-length cap
 * is re-checked on the actual buffer.
 */
export async function readTextFile(
  abs: string,
  maxBytes: number,
): Promise<Buffer | null> {
  let fh;
  try {
    fh = await open(abs, "r");
    const st = await fh.stat();
    if (!st.isFile() || st.size > maxBytes) return null;
    const buf = await fh.readFile();
    if (buf.byteLength > maxBytes) return null;
    if (buf.includes(0)) return null;
    const detected = await fileTypeFromBuffer(buf);
    if (detected) return null;
    return buf;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}
