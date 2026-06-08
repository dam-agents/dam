import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSshEnvironmentFile,
  createSshService,
  refreshSshEnvironment,
} from "../../modules/ssh.js";
import { writeRuntimeEnv } from "../../core/runtime-env.js";

// A real (throwaway) ed25519 public key line.
const KEY_A =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA dam-cli";
const KEY_B =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB other";

describe("createSshService.authorizeKey", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "dam-ssh-svc-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const authorized = () =>
    readFileSync(join(home, ".ssh", "authorized_keys"), "utf8");

  it("rejects a non-key string", async () => {
    const r = await createSshService(home).authorizeKey("not a key");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("Invalid");
  });

  it("rejects a multi-line value (authorized_keys line injection)", async () => {
    const r = await createSshService(home).authorizeKey(
      `${KEY_A}\ncommand="evil" ${KEY_B}`,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("Invalid");
  });

  it("writes the key to authorized_keys", async () => {
    const r = await createSshService(home).authorizeKey(KEY_A);
    expect(r.ok).toBe(true);
    expect(authorized().trim()).toBe(KEY_A);
  });

  it("is idempotent for the same key (even with a different comment)", async () => {
    const svc = createSshService(home);
    await svc.authorizeKey(KEY_A);
    await svc.authorizeKey(KEY_A);
    await svc.authorizeKey(`${KEY_A.split(" ").slice(0, 2).join(" ")} renamed`);
    const lines = authorized().trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("appends distinct keys", async () => {
    const svc = createSshService(home);
    await svc.authorizeKey(KEY_A);
    await svc.authorizeKey(KEY_B);
    const lines = authorized().trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("buildSshEnvironmentFile", () => {
  const parse = (s: string) =>
    Object.fromEntries(
      s
        .split("\n")
        .filter(Boolean)
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );

  it("carries the agent's networking + credentials into the session", () => {
    const out = parse(
      buildSshEnvironmentFile({
        HTTPS_PROXY: "http://10.96.42.42:10000",
        GH_TOKEN: "sentinel-abc",
        ANTHROPIC_API_KEY: "sk-ant-xyz",
        PATH: "/app/node_modules/.bin:/usr/local/bin:/usr/bin",
      }),
    );
    expect(out.HTTPS_PROXY).toBe("http://10.96.42.42:10000");
    expect(out.GH_TOKEN).toBe("sentinel-abc");
    expect(out.ANTHROPIC_API_KEY).toBe("sk-ant-xyz");
    expect(out.PATH).toContain("/app/node_modules/.bin");
  });

  it("drops client-, identity-, and shell-owned vars and npm/ssh noise", () => {
    const out = parse(
      buildSshEnvironmentFile({
        KEEP: "1",
        TERM: "xterm",
        HOME: "/somewhere",
        SHLVL: "3",
        HARNESS_SESSION_ID: "sess-1",
        npm_config_cache: "/x",
        SSH_AUTH_SOCK: "/run/sock",
      }),
    );
    expect(out).toEqual({ KEEP: "1" });
  });

  it("keeps values containing spaces verbatim (no quoting in this file format)", () => {
    const out = parse(
      buildSshEnvironmentFile({ GREETING: "hello world  two" }),
    );
    expect(out.GREETING).toBe("hello world  two");
  });

  it("skips multi-line values that would forge a second line, and warns", () => {
    const warnings: string[] = [];
    const out = parse(
      buildSshEnvironmentFile(
        { OK: "fine", BAD: "line1\ninjected=evil" },
        (m) => warnings.push(m),
      ),
    );
    expect(out.OK).toBe("fine");
    expect(out).not.toHaveProperty("BAD");
    expect(out).not.toHaveProperty("injected");
    expect(warnings.some((w) => w.includes("BAD"))).toBe(true);
  });

  it("ignores non-identifier names sshd would reject", () => {
    const out = parse(
      buildSshEnvironmentFile({ "bad-name": "x", "0lead": "y", good_1: "z" }),
    );
    expect(out).toEqual({ good_1: "z" });
  });
});

describe("refreshSshEnvironment", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "dam-ssh-env-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const envFile = () =>
    Object.fromEntries(
      readFileSync(join(home, ".ssh", "environment"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );

  it("writes the runtime-channel injected env into ~/.ssh/environment", () => {
    writeRuntimeEnv(home, {
      DAM_TEST_TOKEN: "sentinel-1",
      DAM_TEST_FOO: "bar",
    });
    refreshSshEnvironment(home, () => {});
    const out = envFile();
    expect(out.DAM_TEST_TOKEN).toBe("sentinel-1");
    expect(out.DAM_TEST_FOO).toBe("bar");
  });

  // The fix: env injection is hot, so each connection must see the *current*
  // injected env, not a boot-time snapshot. A second refresh reflects changes.
  it("picks up injected-env changes on the next refresh (per-connection freshness)", () => {
    writeRuntimeEnv(home, { DAM_TEST_TOKEN: "old" });
    refreshSshEnvironment(home, () => {});
    expect(envFile().DAM_TEST_TOKEN).toBe("old");

    writeRuntimeEnv(home, { DAM_TEST_TOKEN: "new", DAM_TEST_EXTRA: "added" });
    refreshSshEnvironment(home, () => {});
    const out = envFile();
    expect(out.DAM_TEST_TOKEN).toBe("new");
    expect(out.DAM_TEST_EXTRA).toBe("added");
  });

  it("lets the pod env (process.env) win over injected env on collision", () => {
    const key = "DAM_TEST_PRECEDENCE";
    writeRuntimeEnv(home, { [key]: "from-runtime" });
    process.env[key] = "from-pod";
    try {
      refreshSshEnvironment(home, () => {});
      expect(envFile()[key]).toBe("from-pod");
    } finally {
      delete process.env[key];
    }
  });
});
