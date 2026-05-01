import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  computeContentHash,
  parseFrontmatter,
  PublicArchiveNotFoundError,
  scanPublicGithubArchive,
} from "../../modules/skills/infrastructure/public-archive-scanner.js";

describe("parseFrontmatter", () => {
  it("reads plain scalars", () => {
    expect(parseFrontmatter("---\nname: adr\ndescription: ADRs\n---\nbody")).toEqual({
      name: "adr",
      description: "ADRs",
    });
  });

  it("joins folded (>) block scalars with spaces", () => {
    const content = [
      "---",
      "description: >",
      "  line one",
      "  line two",
      "name: x",
      "---",
    ].join("\n");
    expect(parseFrontmatter(content)).toEqual({ name: "x", description: "line one line two" });
  });
});

describe("computeContentHash", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "apiserver-hash-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("produces stable hex digest depending on contents", async () => {
    await fs.writeFile(path.join(dir, "SKILL.md"), "v1");
    const a = await computeContentHash(dir);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    await fs.writeFile(path.join(dir, "SKILL.md"), "v1");
    expect(await computeContentHash(dir)).toBe(a);
    await fs.writeFile(path.join(dir, "SKILL.md"), "v2");
    expect(await computeContentHash(dir)).not.toBe(a);
  });
});

describe("scanPublicGithubArchive", () => {
  const fetchMock = vi.fn();
  let fixtureRoot: string;

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apiserver-scan-"));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  async function makeTarball(rootName: string, files: Record<string, string>): Promise<Buffer> {
    const root = path.join(fixtureRoot, rootName);
    await fs.mkdir(root, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
    }
    const tgz = path.join(fixtureRoot, `${rootName}.tgz`);
    const res = spawnSync("tar", ["-czf", tgz, "-C", fixtureRoot, rootName]);
    if (res.status !== 0) throw new Error(res.stderr?.toString());
    return fs.readFile(tgz);
  }

  function makeResponse(body: Buffer, finalUrl: string, status = 200): Response {
    const res = new Response(new Uint8Array(body), { status });
    // Node fetch doesn't let us set `url` via constructor, so override for the test.
    Object.defineProperty(res, "url", { value: finalUrl });
    return res;
  }

  it("walks tarball, parses frontmatter, extracts HEAD SHA from redirect URL, computes contentHash", async () => {
    const sha = "e94e714a8c27b0196448e018935dabbb38c3bdf8";
    const tarball = await makeTarball("acme-tools-e94e714", {
      "skills/pdf/SKILL.md": "---\nname: pdf\ndescription: Work with PDFs\n---\nbody",
      "skills/docx/SKILL.md": "---\nname: docx\ndescription: Word docs\n---\nbody",
      "README.md": "# ignored",
    });

    fetchMock.mockResolvedValueOnce(
      makeResponse(tarball, `https://codeload.github.com/acme/tools/tar.gz/${sha}`),
    );

    const skills = await scanPublicGithubArchive("https://github.com/acme/tools");

    expect(skills.map((s) => ({ name: s.name, description: s.description, version: s.version }))).toEqual([
      { name: "docx", description: "Word docs", version: sha },
      { name: "pdf", description: "Work with PDFs", version: sha },
    ]);
    expect(skills[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(skills[1].contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(skills[0].contentHash).not.toBe(skills[1].contentHash);
    // Only one fetch — no api.github.com calls, just the archive endpoint.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://github.com/acme/tools/archive/HEAD.tar.gz",
    );
  });

  it("throws PublicArchiveNotFoundError on 404 so the caller can fall back to authenticated path", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    await expect(scanPublicGithubArchive("https://github.com/acme/private")).rejects.toBeInstanceOf(
      PublicArchiveNotFoundError,
    );
  });

  it("rejects non-GitHub URLs without fetching", async () => {
    await expect(scanPublicGithubArchive("https://gitlab.com/foo/bar")).rejects.toThrow(
      /only GitHub/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
