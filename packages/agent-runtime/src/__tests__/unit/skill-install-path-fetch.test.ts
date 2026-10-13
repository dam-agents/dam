// TEST_OVERVIEW: A GitHub skill source with a path is fetched by directory through the contents API, never by tarball, so an agent whose egress allows only that directory can install and scan it, and the installed content hash matches the tarball fetch.
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
  const leafs = [
    ...Object.keys(fake.files),
    ...Object.keys(symlinks),
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

  const install = (name: string, sourcePath?: string) => {
    const skill = makeSkillName(name);
    if (!skill.ok) throw new Error("invalid name");
    const input: SkillInstallInput = {
      sourceUrl: SOURCE,
      name,
      version: SHA,
      skillPaths: [target],
      ...(sourcePath !== undefined ? { path: sourcePath } : {}),
    };
    return runInstall(
      { github, git: noGit, repo },
      skill.value,
      [target],
      input,
    );
  };

  // TEST_SCENARIO: the QA agent's egress allows only GET contents/qa*, so every request of a path install must stay under that prefix and the nested files must land on disk.
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

  // TEST_SCENARIO: one file over the per-file limit fails the install with a named fetch failure instead of downloading it.
  it("fails on an oversize file", async () => {
    serveGithub({
      files: {
        "qa/p/SKILL.md": skillMd("p"),
        "qa/p/big.bin": "x".repeat(1024 * 1024 + 1),
      },
    });
    const res = await install("p", "qa");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ kind: "SourceFetchFailed" });
  });

  // TEST_SCENARIO: the request cap bounds a huge path, so one install can not issue unbounded contents requests.
  it("fails when the path needs more requests than the cap", async () => {
    const files: Record<string, string> = { "qa/p/SKILL.md": skillMd("p") };
    for (let i = 0; i < MAX_SUBTREE_REQUESTS; i++) files[`qa/p/f${i}`] = "x";
    serveGithub({ files });
    const res = await install("p", "qa");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ kind: "SourceFetchFailed" });
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

  // TEST_SCENARIO: drift detection compares content hashes, so a directory fetch must hash the same as a tarball fetch of the same skill, and a source without a path still uses the tarball.
  it("hashes the same as the tarball install, which a path-less source still uses", async () => {
    const files = {
      "skills/p/SKILL.md": skillMd("p"),
      "skills/p/scripts/run.sh": "#!/bin/sh\necho hi\n",
      "skills/p/.hidden": "dot",
    };
    const tree = path.join(tmp, "tree");
    for (const [rel, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(tree, "acme-mono-x", rel)), {
        recursive: true,
      });
      await fs.writeFile(path.join(tree, "acme-mono-x", rel), content);
    }
    execFileSync("tar", [
      "-czf",
      path.join(tmp, "src.tgz"),
      "-C",
      tree,
      "acme-mono-x",
    ]);
    const tarball = new Uint8Array(
      await fs.readFile(path.join(tmp, "src.tgz")),
    );

    const tarCalls = serveGithub({ files, tarball });
    const byTarball = await install("p");
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
      { source: SOURCE, path: "qa" },
    );
    expect(res.ok && res.value.map((s) => s.name)).toEqual(["qi-profile-dam"]);
    expect(calls.some((c) => c.path.includes("/tarball/"))).toBe(false);
  });
});
