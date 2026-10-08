// TEST_OVERVIEW: `dam ssh configure <agent>` and `dam ssh configure --all` both write one managed ssh_config block per agent through ensureManagedSshHost. The block alias must come from the resolved agent, never from the ref the user typed, so both paths name the same agent the same way and a rewrite replaces the old block.
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureManagedSshHost } from "../modules/ssh/infrastructure/launch.js";
import { sshPaths } from "../modules/ssh/infrastructure/ssh-keys.js";

const agent = { id: "agent-00000000000000ab", name: "My Agent" };

describe("ensureManagedSshHost", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;
  const damConfig = () => join(home, "cfg", "dam", "ssh_config");

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-ssh-"));
    vi.stubEnv("HOME", home);
    env = { XDG_CONFIG_HOME: join(home, "cfg"), XDG_STATE_HOME: home };
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  // TEST_SCENARIO: The single-agent path once keyed the alias on the typed ref, so configuring by ID gave `dam-agent-…` while --all gave `dam-<name>`. Any ref must now give the name alias.
  it("derives the alias from the agent name and proxies by ID", async () => {
    const alias = await ensureManagedSshHost({
      agent,
      paths: sshPaths(env),
      env,
    });
    expect(alias).toBe("dam-my-agent");
    const content = await readFile(damConfig(), "utf8");
    expect(content).toContain("Host dam-my-agent\n");
    expect(content).toContain(`'_proxy' '${agent.id}'`);
  });

  // TEST_SCENARIO: A user who configured by ID before the fix has a `dam-<id>` block. Configuring again must replace it and its own earlier block, not add a second entry for the same agent.
  it("replaces the old ID-alias block and its own previous block", async () => {
    await mkdir(join(home, "cfg", "dam"), { recursive: true });
    await writeFile(
      damConfig(),
      [
        `# >>> dam ssh: dam-${agent.id} (managed) >>>`,
        `Host dam-${agent.id}`,
        `# <<< dam ssh: dam-${agent.id} (managed) <<<`,
        "",
        "# >>> dam ssh: dam-other (managed) >>>",
        "Host dam-other",
        "# <<< dam ssh: dam-other (managed) <<<",
        "",
      ].join("\n"),
    );
    const opts = { agent, paths: sshPaths(env), env };
    await ensureManagedSshHost(opts);
    await ensureManagedSshHost(opts);
    const content = await readFile(damConfig(), "utf8");
    expect(content.match(/^Host /gm)).toEqual(["Host ", "Host "]);
    expect(content).toContain("Host dam-other\n");
    expect(content).toContain("Host dam-my-agent\n");
  });
});
