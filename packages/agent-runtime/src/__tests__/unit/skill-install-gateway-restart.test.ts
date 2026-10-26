// TEST_OVERVIEW: An install reads GitHub through the agent's own gateway pod, and a grant rolls that pod for 5–15 s; a read that fails before GitHub answers must wait out the roll instead of failing the install as UpstreamUnreachable.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillInstallInput } from "agent-runtime-api";
import { createGitHubRestClient } from "../../modules/skills/infrastructure/github-rest-client.js";
import { createLocalSkillRepository } from "../../modules/skills/infrastructure/local-skill-repository.js";
import { makeSkillName } from "../../modules/skills/domain/skill-name.js";
import type { SkillPath } from "../../modules/skills/domain/skill-path.js";
import { runInstall } from "../../modules/skills/services/install.js";
import type { GitProtocolClient } from "../../modules/git/protocol-client.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const SOURCE = "https://github.com/acme/mono";
const NAME = "ponytail";

const connectionRefused = () =>
  new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });

describe("installing a skill while the gateway rolls", () => {
  const repo = createLocalSkillRepository();
  let tmp: string;
  let target: SkillPath;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skill-gateway-restart-"));
    target = path.join(tmp, "skills") as SkillPath;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const tarballOf = async (): Promise<Uint8Array> => {
    const tree = await fs.mkdtemp(path.join(tmp, "tree-"));
    const dir = path.join(tree, "acme-mono-x", NAME);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      `---\nname: ${NAME}\ndescription: about ${NAME}\n---\nbody\n`,
    );
    const tgz = path.join(tree, "src.tgz");
    execFileSync("tar", ["-czf", tgz, "-C", tree, "acme-mono-x"]);
    return new Uint8Array(await fs.readFile(tgz));
  };

  const installOver = (fetchStub: () => Promise<Response>) => {
    vi.stubGlobal("fetch", vi.fn(fetchStub));
    const github = createGitHubRestClient({
      token: () => "platform:conn:a",
      sleep: async () => {},
      log: () => {},
    });
    const skill = makeSkillName(NAME);
    if (!skill.ok) throw new Error("invalid name");
    const input: SkillInstallInput = {
      sourceUrl: SOURCE,
      name: NAME,
      version: SHA,
      skillPaths: [target],
    };
    return runInstall(
      { github, git: {} as GitProtocolClient, repo },
      skill.value,
      [target],
      input,
    );
  };

  // TEST_SCENARIO: a granted connection rolls the gateway pod, so the first reads of an install fail before the new Envoy serves; two such failures must not fail the install, and the skill must land on disk.
  it("installs when the fetch fails twice and then reaches GitHub", async () => {
    const tarball = await tarballOf();
    let reads = 0;
    const res = await installOver(async () => {
      reads += 1;
      if (reads <= 2) throw connectionRefused();
      return new Response(Buffer.from(tarball));
    });
    expect(res.ok).toBe(true);
    expect(reads).toBe(3);
    expect(
      await fs.readFile(path.join(target, NAME, "SKILL.md"), "utf8"),
    ).toContain(`name: ${NAME}`);
  });

  // TEST_SCENARIO: a GitHub that never answers must not be retried forever; once the budget is spent the install fails with UpstreamUnreachable, which is what the driver reports and the api-server retries.
  it("reports UpstreamUnreachable when every fetch fails", async () => {
    let reads = 0;
    const res = await installOver(async () => {
      reads += 1;
      throw connectionRefused();
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({
      kind: "UpstreamUnreachable",
      method: "GET",
      path: `/repos/acme/mono/tarball/${SHA}`,
      detail: "fetch failed: connect ECONNREFUSED",
    });
    expect(reads).toBe(5);
  });
});
