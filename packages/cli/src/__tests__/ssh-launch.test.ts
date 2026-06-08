import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSshArgs,
  clearManagedHosts,
  ensureManagedSshHost,
  pruneManagedHosts,
} from "../modules/ssh/infrastructure/launch.js";
import { inferMode } from "../modules/ssh/commands/ssh.js";
import { sshPaths } from "../modules/ssh/infrastructure/ssh-keys.js";

const paths = sshPaths({ XDG_STATE_HOME: "/tmp/xdg-state" });

describe("inferMode", () => {
  it("maps the known ssh/code/zed launchers", () => {
    expect(inferMode("ssh")).toBe("ssh");
    expect(inferMode("code")).toBe("code");
    expect(inferMode("code-insiders")).toBe("code");
    expect(inferMode("zed")).toBe("zed");
  });

  it("matches exactly, not by substring", () => {
    // "barcode" contains "code" but is not a known launcher.
    expect(inferMode("barcode")).toBeUndefined();
    expect(inferMode("zediot")).toBeUndefined();
    expect(inferMode("vim")).toBeUndefined();
  });
});

describe("buildSshArgs", () => {
  it("wires the dam key, disabled host-key checking, agent user, and a dam-ssh ProxyCommand", () => {
    const args = buildSshArgs({ agentRef: "my-agent", paths });
    const joined = args.join(" ");
    expect(joined).toContain("User=agent");
    expect(joined).toContain("IdentitiesOnly=yes");
    expect(joined).toContain(`IdentityFile=${paths.privateKey}`);
    // Host-key checking is off: throwaway known_hosts + no strict check, since
    // the WSS upgrade is the trust boundary and the pod host key rotates.
    expect(joined).toContain("UserKnownHostsFile=/dev/null");
    expect(joined).toContain("StrictHostKeyChecking=no");
    expect(joined).toContain("PreferredAuthentications=publickey");
    // ProxyCommand re-invokes `dam ssh _proxy <agent>` (each arg sh-quoted).
    expect(joined).toContain("ProxyCommand=");
    expect(joined).toContain("'ssh' '_proxy' 'my-agent'");
    // Positional host is the last arg (the ssh destination token, sanitized).
    expect(args[args.length - 1]).toBe("my-agent");
  });

  it("threads --server into the ProxyCommand and sanitizes the host token", () => {
    const args = buildSshArgs({
      agentRef: "Agent_With.Caps",
      serverFlag: "https://example.test",
      paths,
    });
    const joined = args.join(" ");
    expect(joined).toContain("--server' 'https://example.test'");
    // Host token is lowercased and stripped of unsafe chars for the ssh destination.
    expect(args[args.length - 1]).toBe("agent_with.caps");
  });
});

describe("proxyCommandString resilience chain (via buildSshArgs)", () => {
  it("is a single-line fallback: node+script → PATH node → dam → zsh/bash", () => {
    const joined = buildSshArgs({ agentRef: "my-agent", paths }).join(" ");
    const pc = joined.slice(joined.indexOf("ProxyCommand="));
    // ssh config ProxyCommand must be one line; the chain runs under `sh -c`.
    expect(pc).not.toContain("\n");
    // 1) resolved node interpreter captured at write time.
    expect(pc).toContain(process.execPath);
    // 2) `node` on PATH with the script.
    expect(pc).toContain("command -v node");
    // 3) `dam` on PATH.
    expect(pc).toContain('exec dam "$@"');
    // 4) dam discovered via an rc-loaded zsh, then bash.
    expect(pc).toContain("for s in zsh bash");
  });
});

describe("ensureManagedSshHost", () => {
  let home: string;
  let xdg: string;
  let prevHome: string | undefined;
  const damConfig = () => readFileSync(join(xdg, "dam", "ssh_config"), "utf8");
  const userConfig = () => readFileSync(join(home, ".ssh", "config"), "utf8");

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "dam-ssh-home-"));
    xdg = mkdtempSync(join(tmpdir(), "dam-ssh-xdg-"));
    prevHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(xdg, { recursive: true, force: true });
  });

  it("writes the Host block to dam's own config and Includes it from ~/.ssh/config, idempotently", async () => {
    const env = { XDG_CONFIG_HOME: xdg };
    const alias = await ensureManagedSshHost({
      agentRef: "my-agent",
      paths,
      env,
    });
    expect(alias).toBe("dam-my-agent");

    expect(damConfig()).toContain("Host dam-my-agent");
    expect(damConfig()).toContain("User agent");
    expect(damConfig()).toContain("'ssh' '_proxy' 'my-agent'");
    // The user's config gains exactly one Include pointing at dam's file.
    expect(userConfig()).toContain(`Include ${join(xdg, "dam", "ssh_config")}`);

    await ensureManagedSshHost({ agentRef: "my-agent", paths, env });
    const includes = userConfig()
      .split("\n")
      .filter((l) => l.startsWith("Include ")).length;
    expect(includes).toBe(1);
    const hosts = damConfig()
      .split("\n")
      .filter((l) => l === "Host dam-my-agent").length;
    expect(hosts).toBe(1);
  });

  it("keeps distinct blocks for distinct agents in dam's config", async () => {
    const env = { XDG_CONFIG_HOME: xdg };
    await ensureManagedSshHost({ agentRef: "alpha", paths, env });
    await ensureManagedSshHost({ agentRef: "beta", paths, env });
    expect(damConfig()).toContain("Host dam-alpha");
    expect(damConfig()).toContain("Host dam-beta");
  });
});

describe("pruneManagedHosts / clearManagedHosts", () => {
  let home: string;
  let xdg: string;
  let prevHome: string | undefined;
  const env = () => ({ XDG_CONFIG_HOME: xdg });
  const damCfgPath = () => join(xdg, "dam", "ssh_config");
  const damCfg = () => readFileSync(damCfgPath(), "utf8");
  const userCfg = () => readFileSync(join(home, ".ssh", "config"), "utf8");

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "dam-ssh-home-"));
    xdg = mkdtempSync(join(tmpdir(), "dam-ssh-xdg-"));
    prevHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(xdg, { recursive: true, force: true });
  });

  it("prune removes only blocks whose alias is not in the keep set", async () => {
    for (const a of ["alpha", "beta", "gamma"])
      await ensureManagedSshHost({ agentRef: a, paths, env: env() });
    const removed = await pruneManagedHosts({
      keep: new Set(["dam-alpha", "dam-gamma"]),
      env: env(),
    });
    expect(removed).toEqual(["dam-beta"]);
    const cfg = damCfg();
    expect(cfg).toContain("Host dam-alpha");
    expect(cfg).toContain("Host dam-gamma");
    expect(cfg).not.toContain("Host dam-beta");
  });

  it("prune is a no-op (returns []) when every alias is kept", async () => {
    await ensureManagedSshHost({ agentRef: "alpha", paths, env: env() });
    const removed = await pruneManagedHosts({
      keep: new Set(["dam-alpha"]),
      env: env(),
    });
    expect(removed).toEqual([]);
    expect(damCfg()).toContain("Host dam-alpha");
  });

  it("clear removes every block, deletes the file, and drops the Include", async () => {
    await ensureManagedSshHost({ agentRef: "alpha", paths, env: env() });
    await ensureManagedSshHost({ agentRef: "beta", paths, env: env() });
    expect(userCfg()).toContain("Include ");

    const cleared = await clearManagedHosts({ env: env() });
    expect(cleared).toBe(2);
    expect(existsSync(damCfgPath())).toBe(false);
    expect(userCfg()).not.toContain("Include ");
  });

  it("clear returns 0 when nothing is configured", async () => {
    expect(await clearManagedHosts({ env: env() })).toBe(0);
  });
});
