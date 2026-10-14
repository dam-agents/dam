// TEST_OVERVIEW: When the api-server marks a GitHub skill source with fetch "directory" (the agent's egress denies the archive), the pod fetches only the source path's directory through the contents API and never asks for the tarball; the content hash matches the tarball fetch, and without the mark a path source still uses the tarball.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillInstallInput } from "agent-runtime-api";
import {
  createGitHubRestClient,
  MAX_SUBTREE_REQUESTS,
} from "../../modules/skills/infrastructure/github-rest-client.js";
import { createLocalSkillRepository } from "../../modules/skills/infrastructure/local-skill-repository.js";
import { makeSkillName } from "../../modules/skills/domain/skill-name.js";
import type { SkillPath } from "../../modules/skills/domain/skill-path.js";
import { runInstall } from "../../modules/skills/services/install.js";
import { runScan } from "../../modules/skills/services/scan.js";
import type { GitProtocolClient } from "../../modules/git/protocol-client.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const SOURCE = "https://github.com/acme/mono";

interface FakeRepo {
  files: Record<string, string>;
  symlinks?: Record<string, string>;
  dirLinks?: Record<string, string>;
  submodules?: string[];
  tarball?: Uint8Array;
  private?: boolean;
}

interface Call {
  path: string;
  auth: boolean;
}

const blobSha = (content: string) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest("hex");

function serveGithub(fake: FakeRepo): Call[] {
  const calls: Call[] = [];
  const symlinks = fake.symlinks ?? {};
  const submodules = fake.submodules ?? [];
  const dirLinks = fake.dirLinks ?? {};
  const leafs = [
    ...Object.keys(fake.files),
    ...Object.keys(symlinks),
    ...Object.keys(dirLinks),
    ...submodules,
  ];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const u = new URL(url);
      const auth = Boolean(
        (init.headers as Record<string, string>).Authorization,
      );
      calls.push({ path: u.pathname + u.search, auth });
      if (fake.private && !auth) return json({ message: "Not Found" }, 404);
      if (u.pathname === "/repos/acme/mono/commits/HEAD") {
        return json({ sha: SHA });
      }
      if (u.pathname.startsWith("/repos/acme/mono/tarball/")) {
        return new Response(Buffer.from(fake.tarball ?? new Uint8Array()));
      }
      const p = decodeURIComponent(
        u.pathname.replace("/repos/acme/mono/contents/", ""),
      );
      if (p in dirLinks) {
        return json({ type: "symlink", path: p, target: dirLinks[p] });
      }
      const target = symlinks[p] ?? p;
      if (target in fake.files) {
        return json({
          type: "file",
          encoding: "base64",
          content: Buffer.from(fake.files[target]).toString("base64"),
        });
      }
      const children = new Set(
        leafs
          .filter((l) => l.startsWith(`${p}/`))
          .map((l) => `${p}/${l.slice(p.length + 1).split("/")[0]}`),
      );
      if (children.size === 0) return json({ message: "Not Found" }, 404);
      return json(
        [...children].map((c) => {
          const raw = `https://raw.githubusercontent.com/acme/mono/${SHA}/${c}`;
          if (c in fake.files) {
            const content = fake.files[c];
            const size = Buffer.byteLength(content);
            return {
              type: "file",
              path: c,
              sha: blobSha(content),
              size,
              download_url: raw,
            };
          }
          if (c in symlinks) {
            const size = Buffer.byteLength(symlinks[c]);
            return {
              type: "file",
              path: c,
              sha: blobSha(symlinks[c]),
              size,
              download_url: raw,
            };
          }
          if (c in dirLinks) {
            return {
              type: "symlink",
              path: c,
              sha: blobSha(dirLinks[c]),
              size: Buffer.byteLength(dirLinks[c]),
              download_url: raw,
            };
          }
          if (submodules.includes(c)) {
            return {
              type: "file",
              path: c,
              sha: SHA,
              size: 0,
              download_url: null,
            };
          }
          return {
            type: "dir",
            path: c,
            sha: SHA,
            size: 0,
            download_url: null,
          };
        }),
      );
    }),
  );
  return calls;
}

const skillMd = (name: string) =>
  `---\nname: ${name}\ndescription: about ${name}\n---\nbody\n`;

const noGit = {} as GitProtocolClient;

describe("install and scan of a GitHub source with a path", () => {
  const repo = createLocalSkillRepository();
  const github = createGitHubRestClient({ token: () => "platform:conn:a" });
  let tmp: string;
  let target: SkillPath;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skill-path-fetch-"));
    target = path.join(tmp, "skills") as SkillPath;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const tarballOf = async (files: Record<string, string>) => {
    const tree = await fs.mkdtemp(path.join(tmp, "tree-"));
    for (const [rel, content] of Object.entries(files)) {
      const file = path.join(tree, "acme-mono-x", rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content);
    }
    const tgz = path.join(tree, "src.tgz");
    execFileSync("tar", ["-czf", tgz, "-C", tree, "acme-mono-x"]);
    return new Uint8Array(await fs.readFile(tgz));
  };

  const install = (
    name: string,
    sourcePath?: string,
    fetch: "directory" | "archive" = "directory",
  ) => {
    const skill = makeSkillName(name);
    if (!skill.ok) throw new Error("invalid name");
    const input: SkillInstallInput = {
      sourceUrl: SOURCE,
      name,
      version: SHA,
      skillPaths: [target],
      ...(sourcePath !== undefined ? { path: sourcePath } : {}),
      ...(fetch === "directory" ? { fetch } : {}),
    };
    return runInstall(
      { github, git: noGit, repo },
      skill.value,
      [target],
      input,
    );
  };

  // TEST_SCENARIO: the QA agent's egress allows only GET contents/qa/* and contents/qa?*, so every request of a path install must fall under one of them and the nested files must land on disk.
  it("installs a skill below the path through contents requests only", async () => {
    const calls = serveGithub({
      files: {
        "qa/qi-profile-dam/SKILL.md": skillMd("qi-profile-dam"),
        "qa/qi-profile-dam/refs/deep/notes.md": "nested",
        "qa/other/SKILL.md": skillMd("other"),
        "src/secret.ts": "never read",
      },
    });
    const res = await install("qi-profile-dam", "qa");
    expect(res.ok).toBe(true);
    expect(
      await fs.readFile(
        path.join(target, "qi-profile-dam", "refs", "deep", "notes.md"),
        "utf8",
      ),
    ).toBe("nested");
    for (const call of calls) {
      expect(call.path).toMatch(/^\/repos\/acme\/mono\/contents\/qa[/?]/);
    }
  });

  // TEST_SCENARIO: a path may name the skill directory itself rather than its parent.
  it("installs a path that is itself the skill directory", async () => {
    serveGithub({ files: { "qa/SKILL.md": skillMd("qa-profile") } });
    const res = await install("qa-profile", "qa");
    expect(res.ok).toBe(true);
    await fs.access(path.join(target, "qa-profile", "SKILL.md"));
  });

  // TEST_SCENARIO: GitHub lists a symlink as a file and serves its target's content, and a submodule as a file with no download URL; both are left out, as the tarball install refuses them.
  it("skips symlinks and submodules", async () => {
    serveGithub({
      files: {
        "qa/p/SKILL.md": skillMd("p"),
        "src/secret.ts": "never read",
      },
      symlinks: { "qa/p/leak.ts": "src/secret.ts" },
      submodules: ["qa/p/vendor"],
    });
    const res = await install("p", "qa");
    expect(res.ok).toBe(true);
    expect((await fs.readdir(path.join(target, "p"))).sort()).toEqual([
      "SKILL.md",
    ]);
  });

  // TEST_SCENARIO: a file over the per-file limit or a path over the request cap fails the directory fetch with a named error, and the pod never asks for the tarball the agent's egress denies.
  it.each([
    ["an oversize file", { "qa/p/big.bin": "x".repeat(1024 * 1024 + 1) }],
    [
      "more requests than the cap",
      Object.fromEntries(
        Array.from({ length: MAX_SUBTREE_REQUESTS }, (_, i) => [
          `qa/p/f${i}`,
          "x",
        ]),
      ),
    ],
  ])("fails on %s without the tarball", async (_, extra) => {
    const calls = serveGithub({
      files: { "qa/p/SKILL.md": skillMd("p"), ...extra },
    });
    const res = await install("p", "qa");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ kind: "SourceFetchFailed" });
    expect(calls.some((c) => c.path.includes("/tarball/"))).toBe(false);
    expect(calls.length).toBeLessThanOrEqual(MAX_SUBTREE_REQUESTS + 2);
  });

  // TEST_SCENARIO: a repository may publish a skill root as a symlink to another directory (this repository links .claude/skills to .agents/skills); the contents API does not follow it, so the fetch resolves the link and fetches only the named skill below its target.
  it("installs and scans through a symlinked path", async () => {
    const fake = {
      files: {
        ".agents/skills/p/SKILL.md": skillMd("p"),
        ".agents/skills/p/refs/a.md": "a",
        ".agents/skills/other/SKILL.md": skillMd("other"),
      },
      dirLinks: { ".claude/skills": "../.agents/skills" },
    };
    const calls = serveGithub(fake);
    const res = await install("p", ".claude/skills");
    expect(res.ok).toBe(true);
    expect(
      await fs.readFile(path.join(target, "p", "refs", "a.md"), "utf8"),
    ).toBe("a");
    expect(calls.some((c) => c.path.includes("/tarball/"))).toBe(false);
    expect(calls.some((c) => c.path.includes("/other"))).toBe(false);

    serveGithub(fake);
    const scan = await runScan(
      { github, git: noGit, repo, log: () => {} },
      { source: SOURCE, path: ".claude/skills", fetch: "directory" },
    );
    expect(scan.ok && scan.value.map((s) => s.dir)).toEqual([
      ".claude/skills/other",
      ".claude/skills/p",
    ]);
  });

  // TEST_SCENARIO: a private repository answers 404 anonymously; the fetch retries the whole directory authenticated.
  it("retries authenticated after an anonymous 404", async () => {
    const calls = serveGithub({
      files: { "qa/p/SKILL.md": skillMd("p") },
      private: true,
    });
    const res = await install("p", "qa");
    expect(res.ok).toBe(true);
    expect(calls[0].auth).toBe(false);
    expect(calls.slice(1).every((c) => c.auth)).toBe(true);
  });

  // TEST_SCENARIO: drift detection compares content hashes, so a directory fetch must hash the same as a tarball fetch of the same skill; a path source without the directory mark still uses the tarball, exactly as before.
  it("hashes the same as the tarball install, which an unmarked path source still uses", async () => {
    const files = {
      "skills/p/SKILL.md": skillMd("p"),
      "skills/p/scripts/run.sh": "#!/bin/sh\necho hi\n",
      "skills/p/.hidden": "dot",
    };
    const tarball = await tarballOf(files);

    const tarCalls = serveGithub({ files, tarball });
    const byTarball = await install("p", "skills", "archive");
    expect(tarCalls.map((c) => c.path)).toEqual([
      `/repos/acme/mono/tarball/${SHA}`,
    ]);
    vi.unstubAllGlobals();

    serveGithub({ files });
    const byDirectory = await install("p", "skills");
    expect(byTarball.ok && byDirectory.ok).toBe(true);
    if (!byTarball.ok || !byDirectory.ok) return;
    expect(byDirectory.value.contentHash).toBe(byTarball.value.contentHash);
  });

  // TEST_SCENARIO: the pod scan of a path source lists the skills under the path without downloading the repository.
  it("scans a path source without the tarball", async () => {
    const calls = serveGithub({
      files: { "qa/qi-profile-dam/SKILL.md": skillMd("qi-profile-dam") },
    });
    const res = await runScan(
      { github, git: noGit, repo, log: () => {} },
      { source: SOURCE, path: "qa", fetch: "directory" },
    );
    expect(res.ok && res.value.map((s) => s.name)).toEqual(["qi-profile-dam"]);
    expect(calls.some((c) => c.path.includes("/tarball/"))).toBe(false);
  });
});
