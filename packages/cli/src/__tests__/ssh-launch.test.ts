import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSshArgs,
  ensureManagedSshHost,
  gatewayConnectUrl,
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

  it("maps the gateway launcher and per-IDE JetBrains launchers to jetbrains", () => {
    for (const bin of [
      "gateway",
      "pycharm",
      "idea",
      "goland",
      "webstorm",
      "clion",
      "rider",
      "datagrip",
    ])
      expect(inferMode(bin)).toBe("jetbrains");
  });

  it("matches exactly, not by substring", () => {
    // "barcode" contains "code" but is not a known launcher.
    expect(inferMode("barcode")).toBeUndefined();
    expect(inferMode("zediot")).toBeUndefined();
    expect(inferMode("vim")).toBeUndefined();
  });
});

describe("gatewayConnectUrl", () => {
  it("builds an ssh connect link bound to the managed alias and remote workdir", () => {
    const url = gatewayConnectUrl("dam-my-agent");
    expect(url.startsWith("jetbrains-gateway://connect#")).toBe(true);
    const params = new URLSearchParams(url.split("#")[1]);
    expect(params.get("type")).toBe("ssh");
    expect(params.get("host")).toBe("dam-my-agent");
    expect(params.get("user")).toBe("agent");
    expect(params.get("port")).toBe("22");
    // projectPath is the agent workspace, percent-encoded in the link.
    expect(params.get("projectPath")).toBe("/home/agent/work");
    expect(url).toContain("projectPath=%2Fhome%2Fagent%2Fwork");
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
