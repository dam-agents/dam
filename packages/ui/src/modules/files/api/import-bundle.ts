import { authFetch } from "../../../auth.js";

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

export interface FilterReport {
  kept: BundleEntry[];
  dropped: number;
}

export function filterImportEntries(entries: BundleEntry[]): FilterReport {
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

/** Flatten a DataTransferItemList (from a drop) into BundleEntry[].
 *  Paths are deduped — dropping the same folder twice yields one entry per
 *  child, not two with identical paths that would later confuse tar
 *  consumers (last entry would silently win on extract). */
export async function walkDataTransfer(items: DataTransferItemList): Promise<BundleEntry[]> {
  const raw: BundleEntry[] = [];
  const promises: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const fsEntry = items[i].webkitGetAsEntry?.();
    if (!fsEntry) continue;
    promises.push(walkEntry(fsEntry, "", raw));
  }
  await Promise.all(promises);
  const seen = new Set<string>();
  const out: BundleEntry[] = [];
  for (const e of raw) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    out.push(e);
  }
  return out;
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
 * USTAR's `name` field is 100 bytes, plus a 155-byte `prefix` field that
 * concatenates as `prefix + "/" + name`. Real-world trees (`.git/objects`,
 * deep node_modules) easily exceed 100 bytes, so we use the prefix when
 * we have to. Paths that don't fit even after split are rejected loudly
 * — long-name PAX extensions are out of scope for the demo cut.
 */
const MAX_TAR_NAME_BYTES = 100;
const MAX_TAR_PREFIX_BYTES = 155;

type UstarPath = { name: string; prefix: string };

/** Split `path` into USTAR `prefix`/`name` so that both fit their fields.
 *  Returns null when no `/` boundary produces a valid split. */
function splitUstarPath(path: string, enc: TextEncoder): UstarPath | null {
  if (enc.encode(path).byteLength <= MAX_TAR_NAME_BYTES) {
    return { name: path, prefix: "" };
  }
  // Walk slash positions right-to-left to find the rightmost split where
  // `name` (after the slash) fits 100 bytes; reject if the prefix part
  // (before the slash) exceeds 155 bytes.
  let slash = path.lastIndexOf("/");
  while (slash > 0) {
    const namePart = path.slice(slash + 1);
    const prefixPart = path.slice(0, slash);
    if (
      enc.encode(namePart).byteLength <= MAX_TAR_NAME_BYTES
      && enc.encode(prefixPart).byteLength <= MAX_TAR_PREFIX_BYTES
    ) {
      return { name: namePart, prefix: prefixPart };
    }
    slash = path.lastIndexOf("/", slash - 1);
  }
  return null;
}

/**
 * Build a raw (uncompressed) USTAR tar Blob from the entries. We
 * deliberately don't gzip in the browser:
 *
 *  1. Most pain inputs are already-compressed binary (MKV, MP4, .git
 *     pack files) where gzip barely shrinks anything.
 *  2. `CompressionStream` piped into `new Response(stream).blob()`
 *     forces the browser to materialize the whole compressed output
 *     into a Blob before the upload starts. For multi-GB inputs that
 *     hits the origin storage quota and the underlying stream gets
 *     aborted mid-write, leaving a truncated body that the server
 *     extracts as a partial tar with no EOF blocks — the parser then
 *     hangs waiting for more bytes.
 *
 * The resulting Blob references each `File` lazily (Blob's constructor
 * accepts Blobs as parts), so the fetch upload reads from disk as the
 * stream is consumed. No memory or disk materialization here. The
 * `tar` package on the server auto-detects gzip vs raw input, so the
 * extract side needs no change. The upload size ceiling is the
 * server's `maxImportBundleBytes` cap.
 */
export async function buildBundle(entries: BundleEntry[]): Promise<Blob> {
  const enc = new TextEncoder();
  const splits: UstarPath[] = entries.map((ent) => {
    const split = splitUstarPath(ent.path, enc);
    if (!split) {
      throw new Error(`path too long for USTAR tar header (name>${MAX_TAR_NAME_BYTES}B and no /-split fits within prefix ${MAX_TAR_PREFIX_BYTES}B): ${ent.path}`);
    }
    return split;
  });

  const tarParts: BlobPart[] = [];
  // Casts to ArrayBuffer: TS's strict `ArrayBufferLike` includes
  // `SharedArrayBuffer`, which `BlobPart` doesn't accept. Our buffers
  // come from `new Uint8Array(n)` — all regular ArrayBuffers; the cast
  // narrows the type without changing runtime behavior.
  for (let i = 0; i < entries.length; i++) {
    const ent = entries[i];
    tarParts.push(tarHeader(splits[i], ent.file.size).buffer as ArrayBuffer);
    tarParts.push(ent.file);
    const pad = (512 - (ent.file.size % 512)) % 512;
    if (pad) tarParts.push(new Uint8Array(pad).buffer as ArrayBuffer);
  }
  // Two zero blocks to mark end-of-archive.
  tarParts.push(new Uint8Array(1024).buffer as ArrayBuffer);
  return new Blob(tarParts, { type: "application/x-tar" });
}

function tarHeader(path: UstarPath, size: number): Uint8Array {
  const buf = new Uint8Array(512);
  // name (100)
  writeStr(buf, 0, path.name, 100);
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
  // prefix (155) at offset 345 — concatenated as prefix + "/" + name on read
  if (path.prefix.length > 0) writeStr(buf, 345, path.prefix, 155);
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
  const res = await authFetch(`/api/instances/${encodeURIComponent(instanceId)}/import`, {
    method: "POST",
    body: form,
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
  return postBundle(instanceId, bundle, mode, prefix, "bundle.tar");
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
  const res = await authFetch(`/api/instances/${encodeURIComponent(instanceId)}/import-preflight`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths, prefix }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || res.statusText);
  }
  const body = (await res.json()) as { conflicts: string[] };
  return body.conflicts;
}
