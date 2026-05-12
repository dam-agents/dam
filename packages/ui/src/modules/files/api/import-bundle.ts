export type BundleEntry = { path: string; file: File };

/**
 * Path segments dropped before upload — for ergonomics, not safety.
 * Two kinds:
 *   - Build/cache dirs whose contents are OS- or arch-specific and
 *     regenerate inside the pod (your mac's compiled `sharp` won't
 *     load on Linux; `npm install` will rebuild it correctly).
 *   - Platform-reserved paths the server will reject anyway — filtered
 *     here so the user doesn't see a confusing 422 for those files.
 *
 * `.git/` is deliberately NOT in this set: bringing repo history is
 * legitimate context. Size is the user's call.
 */
const EXCLUDE_FROM_IMPORT = new Set([
  // arch/OS-specific or regenerable — wastes the upload, can break runtime
  "node_modules",
  ".venv",
  "__pycache__",
  // server-reserved (mirrors RESERVED_SEGMENTS in extract.ts)
  ".triggers",
  ".initialized",
  // cosmetic noise
  ".DS_Store",
]);

export function filterImportEntries(entries: BundleEntry[]): { kept: BundleEntry[]; dropped: number } {
  let dropped = 0;
  const kept: BundleEntry[] = [];
  for (const e of entries) {
    const segs = e.path.split("/");
    if (segs.some((s) => EXCLUDE_FROM_IMPORT.has(s))) {
      dropped++;
      continue;
    }
    kept.push(e);
  }
  return { kept, dropped };
}

/** Flatten a DataTransferItemList (from a drop) into BundleEntry[]. */
export async function walkDataTransfer(items: DataTransferItemList): Promise<BundleEntry[]> {
  const entries: BundleEntry[] = [];
  const promises: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const fsEntry = items[i].webkitGetAsEntry?.();
    if (!fsEntry) continue;
    promises.push(walkEntry(fsEntry, "", entries));
  }
  await Promise.all(promises);
  return entries;
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: BundleEntry[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((res, rej) => fileEntry.file(res, rej));
    out.push({ path: `${prefix}${entry.name}`, file });
    return;
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const children = await readAll(reader);
    await Promise.all(children.map((c) => walkEntry(c, `${prefix}${entry.name}/`, out)));
  }
}

function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const read = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          read();
        }
      }, reject);
    read();
  });
}

/** Compute the unique top-level path segments from a list of entries. */
export function topLevelOf(entries: BundleEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) set.add(e.path.split("/")[0]);
  return [...set];
}

/**
 * USTAR's `name` field is 100 bytes. We don't bother with the `prefix`
 * extension yet — paths longer than 100 bytes get rejected loudly here
 * rather than truncated into a different (and possibly traversal-unsafe)
 * server-side path.
 */
const MAX_TAR_NAME_BYTES = 100;

/**
 * Build a tar.gz Blob from the entries. Hand-rolls a USTAR tar layer
 * and pipes through CompressionStream("gzip"). Sufficient for our
 * use case (regular files only, no symlinks or perms) and avoids
 * pulling in a tar npm bundle just for the browser side.
 */
export async function buildBundle(entries: BundleEntry[]): Promise<Blob> {
  const enc = new TextEncoder();
  for (const ent of entries) {
    const nameBytes = enc.encode(ent.path).byteLength;
    if (nameBytes > MAX_TAR_NAME_BYTES) {
      throw new Error(`path too long for tar header (${nameBytes} bytes, limit ${MAX_TAR_NAME_BYTES}): ${ent.path}`);
    }
  }
  const tarChunks: BlobPart[] = [];
  // Casts to ArrayBuffer: TS's strict ArrayBufferLike includes
  // SharedArrayBuffer, which BlobPart doesn't accept. Our buffers
  // come from `await file.arrayBuffer()` and `new Uint8Array(n)`
  // — both produce regular ArrayBuffers; the cast is a narrow.
  for (const ent of entries) {
    const data = new Uint8Array(await ent.file.arrayBuffer());
    tarChunks.push(tarHeader(ent.path, data.length).buffer as ArrayBuffer);
    tarChunks.push(data.buffer as ArrayBuffer);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) tarChunks.push(new Uint8Array(pad).buffer as ArrayBuffer);
  }
  // Two zero blocks to mark end-of-archive.
  tarChunks.push(new Uint8Array(1024).buffer as ArrayBuffer);
  const tarBlob = new Blob(tarChunks);
  const gz = tarBlob.stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(gz).blob();
}

function tarHeader(path: string, size: number): Uint8Array {
  const buf = new Uint8Array(512);
  // name (100)
  writeStr(buf, 0, path, 100);
  // mode "0000666\0"
  writeOct(buf, 100, 0o666, 8);
  // uid, gid
  writeOct(buf, 108, 0, 8);
  writeOct(buf, 116, 0, 8);
  // size (12)
  writeOct(buf, 124, size, 12);
  // mtime
  writeOct(buf, 136, Math.floor(Date.now() / 1000), 12);
  // chksum placeholder = 8 spaces
  for (let i = 148; i < 156; i++) buf[i] = 0x20;
  // typeflag '0' = regular file
  buf[156] = 0x30;
  // ustar magic + version
  writeStr(buf, 257, "ustar", 6);
  buf[263] = 0x30;
  buf[264] = 0x30;
  // checksum
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  writeOct(buf, 148, sum, 7);
  buf[155] = 0x20;
  return buf;
}

function writeStr(buf: Uint8Array, off: number, s: string, len: number) {
  const enc = new TextEncoder().encode(s);
  buf.set(enc.subarray(0, len), off);
}

function writeOct(buf: Uint8Array, off: number, n: number, len: number) {
  const s = n.toString(8).padStart(len - 1, "0");
  writeStr(buf, off, s, len - 1);
  buf[off + len - 1] = 0;
}

export type ImportBundleArgs = {
  instanceId: string;
  entries: BundleEntry[];
  mode: "replace" | "merge";
  prefix?: string;
};

export type ImportBundleResult = {
  filesWritten: number;
  bytes: number;
  durationMs: number;
};

async function postBundle(
  instanceId: string,
  bundle: Blob,
  mode: "replace" | "merge",
  prefix: string | undefined,
  filename: string,
): Promise<ImportBundleResult> {
  const form = new FormData();
  form.set("mode", mode);
  if (prefix) form.set("prefix", prefix);
  form.set("bundle", bundle, filename);
  const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/import`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export async function importBundle({
  instanceId,
  entries,
  mode,
  prefix,
}: ImportBundleArgs): Promise<ImportBundleResult> {
  const bundle = await buildBundle(entries);
  return postBundle(instanceId, bundle, mode, prefix, "bundle.tar.gz");
}

/**
 * Pass-through upload for a pre-built tar / tar.gz / tgz bundle. Skips
 * the client-side tar layer entirely — the file is sent to the server
 * verbatim. Use when the user already has a packaged context bundle and
 * we shouldn't re-wrap it.
 */
export type ImportRawBundleArgs = {
  instanceId: string;
  bundle: Blob | File;
  mode: "replace" | "merge";
  prefix?: string;
};

export async function importRawBundle({
  instanceId,
  bundle,
  mode,
  prefix,
}: ImportRawBundleArgs): Promise<ImportBundleResult> {
  const filename = bundle instanceof File ? bundle.name : "bundle.tar.gz";
  return postBundle(instanceId, bundle, mode, prefix, filename);
}

/**
 * Best-effort filename check: if a single dropped/picked file has one
 * of these extensions, we send it as-is instead of wrapping it in a
 * fresh tar.
 */
export function isTarballName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".tar") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
}

export async function importPreflight(
  instanceId: string,
  paths: string[],
  prefix?: string,
): Promise<string[]> {
  const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/import-preflight`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths, prefix }),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || res.statusText);
  }
  const body = (await res.json()) as { conflicts: string[] };
  return body.conflicts;
}
