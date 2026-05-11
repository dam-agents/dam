import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { create as createTar } from "tar";
import { extractBundle } from "../../modules/import/extract.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "extract-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * Build a tar (uncompressed) of a real directory tree.
 */
async function tarFromDir(srcDir: string, paths: string[]): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of createTar({ cwd: srcDir, gzip: false }, paths)) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * Hand-craft a single-file tar header + data so we can test entry names
 * the `tar` packer would otherwise normalize away (absolute paths, ..).
 */
function rawTarFile(name: string, content: string): Buffer {
  const header = Buffer.alloc(512);
  const data = Buffer.from(content, "utf8");
  // name (100 bytes)
  header.write(name, 0, Math.min(name.length, 100), "utf8");
  // mode "0000644\0"
  header.write("0000644\0", 100, "ascii");
  // uid, gid "0000000\0"
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  // size (octal, 11 digits + null)
  const sizeStr = data.length.toString(8).padStart(11, "0");
  header.write(sizeStr + "\0", 124, "ascii");
  // mtime
  header.write("0".padStart(11, "0") + "\0", 136, "ascii");
  // chksum placeholder = spaces
  header.write("        ", 148, "ascii");
  // typeflag '0' = regular file
  header.write("0", 156, "ascii");
  // linkname (100 bytes) — left zero
  // magic "ustar\0"
  header.write("ustar\0", 257, "ascii");
  // version "00"
  header.write("00", 263, "ascii");
  // checksum
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  // pad data to 512 boundary
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  // two zero blocks terminator
  const eof = Buffer.alloc(1024);
  return Buffer.concat([header, data, pad, eof]);
}

describe("extractBundle", () => {
  it("extracts a happy-path bundle", async () => {
    const src = mkdtempSync(join(tmpdir(), "tar-src-"));
    try {
      writeFileSync(join(src, "CLAUDE.md"), "hello");
      mkdirSync(join(src, ".claude"));
      writeFileSync(join(src, ".claude/settings.json"), "{}");
      const buf = await tarFromDir(src, ["CLAUDE.md", ".claude"]);
      const result = await extractBundle(Readable.from(buf), tmp);
      expect(readFileSync(join(tmp, "CLAUDE.md"), "utf8")).toBe("hello");
      expect(readFileSync(join(tmp, ".claude/settings.json"), "utf8")).toBe("{}");
      expect(result.filesWritten).toBe(2);
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  });

  it("rejects symlink entries", async () => {
    const src = mkdtempSync(join(tmpdir(), "tar-src-"));
    try {
      symlinkSync("/etc/passwd", join(src, "evil-link"));
      const buf = await tarFromDir(src, ["evil-link"]);
      await expect(extractBundle(Readable.from(buf), tmp)).rejects.toThrow();
      expect(existsSync(join(tmp, "evil-link"))).toBe(false);
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  });

  it("rejects absolute-path entries", async () => {
    const buf = rawTarFile("/etc/evil", "evil");
    await expect(extractBundle(Readable.from(buf), tmp)).rejects.toThrow();
    expect(existsSync(join(tmp, "etc/evil"))).toBe(false);
  });

  it("rejects path-traversal entries", async () => {
    const buf = rawTarFile("../escape", "evil");
    await expect(extractBundle(Readable.from(buf), tmp)).rejects.toThrow();
  });

  it("rejects platform-reserved path segments", async () => {
    const src = mkdtempSync(join(tmpdir(), "tar-src-"));
    try {
      mkdirSync(join(src, ".triggers"));
      writeFileSync(join(src, ".triggers/evil.json"), "{}");
      const buf = await tarFromDir(src, [".triggers"]);
      await expect(extractBundle(Readable.from(buf), tmp)).rejects.toThrow(/reserved/i);
      expect(existsSync(join(tmp, ".triggers/evil.json"))).toBe(false);
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  });
});
