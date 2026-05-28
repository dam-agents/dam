import {
  type ImportBundleResult,
  importBundleResultSchema,
} from "agent-runtime-api";

import { authFetch } from "../../../auth.js";

export type BundleEntry = { path: string; file: File };

/**
 * Path segments dropped before upload — for ergonomics, not safety.
 * Build/cache dirs whose contents are OS- or arch-specific and regenerate
 * inside the pod (your mac's compiled `sharp` won't load on Linux;
 * `npm install` will rebuild it correctly), plus cosmetic noise.
 *
 * `.git/` is deliberately NOT in this set: bringing repo history is
 * legitimate context. Size is the user's call.
 */
const EXCLUDE_FROM_IMPORT = new Set([
  "node_modules",
  ".venv",
  "__pycache__",
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
export async function walkDataTransfer(
  items: DataTransferItemList,
): Promise<BundleEntry[]> {
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

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: BundleEntry[],
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((res, rej) =>
      fileEntry.file(res, rej),
    );
    out.push({ path: `${prefix}${entry.name}`, file });
    return;
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const children = await readAll(reader);
    await Promise.all(
      children.map((c) => walkEntry(c, `${prefix}${entry.name}/`, out)),
    );
  }
}

function readAll(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
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

/**
 * USTAR's `name` field is 100 bytes, plus a 155-byte `prefix` field that
 * concatenates as `prefix + "/" + name`. Real-world trees (`.git/objects`,
 * deep node_modules) easily exceed 100 bytes, so we use the prefix when
 * we have to. Paths that don't fit even after split are rejected loudly
 * — long-name PAX extensions are out of scope for the demo cut.
 */
const MAX_TAR_NAME_BYTES = 100;
const MAX_TAR_PREFIX_BYTES = 155;
const TAR_ENCODER = new TextEncoder();

type UstarPath = { name: string; prefix: string };

/** Split `path` into USTAR `prefix`/`name` so that both fit their fields.
 *  Returns null when no `/` boundary produces a valid split. */
function splitUstarPath(path: string, enc: TextEncoder): UstarPath | null {
  if (enc.encode(path).byteLength <= MAX_TAR_NAME_BYTES) {
    return { name: path, prefix: "" };
  }
  let slash = path.lastIndexOf("/");
  while (slash > 0) {
    const namePart = path.slice(slash + 1);
    const prefixPart = path.slice(0, slash);
    if (
      enc.encode(namePart).byteLength <= MAX_TAR_NAME_BYTES &&
      enc.encode(prefixPart).byteLength <= MAX_TAR_PREFIX_BYTES
    ) {
      return { name: namePart, prefix: prefixPart };
    }
    slash = path.lastIndexOf("/", slash - 1);
  }
  return null;
}

/**
 * Build a raw (uncompressed) USTAR tar Blob from the entries. We
 * deliberately don't gzip in the browser: most pain inputs are already
 * compressed (MKV, MP4, .git pack files), and `CompressionStream` piped
 * into `new Response(stream).blob()` materializes the whole compressed
 * output as a Blob before upload — for multi-GB inputs that hits origin
 * storage quota and truncates the body. The Blob references each `File`
 * lazily, so the fetch upload reads from disk as the stream is consumed.
 * The `tar` package on the server auto-detects gzip vs raw input.
 */
export async function buildBundle(entries: BundleEntry[]): Promise<Blob> {
  const splits: UstarPath[] = entries.map((ent) => {
    const split = splitUstarPath(ent.path, TAR_ENCODER);
    if (!split) {
      throw new Error(
        `path too long for USTAR tar header (name>${MAX_TAR_NAME_BYTES}B and no /-split fits within prefix ${MAX_TAR_PREFIX_BYTES}B): ${ent.path}`,
      );
    }
    return split;
  });

  const tarParts: BlobPart[] = [];
  for (let i = 0; i < entries.length; i++) {
    const ent = entries[i];
    tarParts.push(tarHeader(splits[i], ent.file.size).buffer as ArrayBuffer);
    tarParts.push(ent.file);
    const pad = (512 - (ent.file.size % 512)) % 512;
    if (pad) tarParts.push(new Uint8Array(pad).buffer as ArrayBuffer);
  }
  tarParts.push(new Uint8Array(1024).buffer as ArrayBuffer);
  return new Blob(tarParts, { type: "application/x-tar" });
}

function tarHeader(path: UstarPath, size: number): Uint8Array {
  const buf = new Uint8Array(512);
  writeStr(buf, 0, path.name, 100);
  writeOct(buf, 100, 0o666, 8);
  writeOct(buf, 108, 0, 8);
  writeOct(buf, 116, 0, 8);
  writeOct(buf, 124, size, 12);
  writeOct(buf, 136, Math.floor(Date.now() / 1000), 12);
  for (let i = 148; i < 156; i++) buf[i] = 0x20;
  buf[156] = 0x30;
  writeStr(buf, 257, "ustar", 6);
  buf[263] = 0x30;
  buf[264] = 0x30;
  if (path.prefix.length > 0) writeStr(buf, 345, path.prefix, 155);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  writeOct(buf, 148, sum, 7);
  buf[155] = 0x20;
  return buf;
}

function writeStr(buf: Uint8Array, off: number, s: string, len: number) {
  const enc = TAR_ENCODER.encode(s);
  buf.set(enc.subarray(0, len), off);
}

function writeOct(buf: Uint8Array, off: number, n: number, len: number) {
  const s = n.toString(8).padStart(len - 1, "0");
  writeStr(buf, off, s, len - 1);
  buf[off + len - 1] = 0;
}

export type ImportBundleArgs = {
  agentId: string;
  entries: BundleEntry[];
};

async function postBundle(
  agentId: string,
  bundle: Blob,
  filename: string,
): Promise<ImportBundleResult> {
  const form = new FormData();
  form.set("bundle", bundle, filename);
  const res = await authFetch(
    `/api/agents/${encodeURIComponent(agentId)}/import`,
    {
      method: "POST",
      body: form,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || res.statusText);
  }
  const parsed = importBundleResultSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.warn(
      "[import-bundle] schema mismatch on import response:",
      parsed.error.issues,
    );
    // Degraded-but-valid response. Callers display these counts in a success
    // toast — zeros surface "upload completed, stats unavailable" rather
    // than crashing on undefined fields.
    return { filesWritten: 0, bytes: 0, durationMs: 0 };
  }
  return parsed.data;
}

export async function importBundle({
  agentId,
  entries,
}: ImportBundleArgs): Promise<ImportBundleResult> {
  const bundle = await buildBundle(entries);
  return postBundle(agentId, bundle, "bundle.tar");
}

/**
 * Pass-through upload for a pre-built tar / tar.gz / tgz bundle. Skips
 * the client-side tar layer entirely — the file is sent to the server
 * verbatim. Use when the user already has a packaged context bundle and
 * we shouldn't re-wrap it.
 */
export type ImportRawBundleArgs = {
  agentId: string;
  bundle: Blob | File;
};

export async function importRawBundle({
  agentId,
  bundle,
}: ImportRawBundleArgs): Promise<ImportBundleResult> {
  const filename = bundle instanceof File ? bundle.name : "bundle.tar.gz";
  return postBundle(agentId, bundle, filename);
}

/**
 * Best-effort filename check: if a single dropped/picked file has one
 * of these extensions, we send it as-is instead of wrapping it in a
 * fresh tar.
 */
export function isTarballName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".tar") ||
    lower.endsWith(".tar.gz") ||
    lower.endsWith(".tgz")
  );
}
