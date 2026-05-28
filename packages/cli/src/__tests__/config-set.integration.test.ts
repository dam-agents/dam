import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

const exec = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "../..");
const BIN_PATH = join(PKG_ROOT, "dist", "bin.js");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runDam(
  args: string[],
  env: Record<string, string>,
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await exec("node", [BIN_PATH, ...args], { env });
    return { exitCode: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

describe("dam config set (integration)", () => {
  beforeAll(async () => {
    await exec("pnpm", ["exec", "tsup"], { cwd: PKG_ROOT });
  }, 60_000);

  let home: string;
  let configPath: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-cfg-set-"));
    configPath = join(home, ".config", "dam", "config.toml");
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  afterAll(async () => {
    // Best-effort — leave dist/ in place; subsequent test runs reuse the
    // beforeAll build.
  });

  it("writes a valid TOML file with the server key", async () => {
    const r = await runDam(
      ["config", "set", "server", "https://example.test"],
      { HOME: home, PATH: process.env.PATH ?? "" },
    );

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("wrote server = https://example.test");
    expect(r.stdout).toContain(configPath);

    const contents = await readFile(configPath, "utf-8");
    expect(contents.trim()).toBe('server = "https://example.test"');
  });

  it("rejects an invalid URL with non-zero exit and helpful stderr", async () => {
    const r = await runDam(["config", "set", "server", "not-a-url"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });

    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("invalid value for `server`");
    expect(r.stderr).toContain("not-a-url");

    // File must not exist (no partial writes on validation failure).
    await expect(readFile(configPath, "utf-8")).rejects.toThrow();
  });

  it.each([
    ["mailto:foo", "mailto"],
    ["file:///etc/passwd", "file"],
    ["ftp://example.test/x", "ftp"],
  ])("rejects non-http(s) URL %s", async (input) => {
    const r = await runDam(["config", "set", "server", input], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });

    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("must be an http(s) URL");
    await expect(readFile(configPath, "utf-8")).rejects.toThrow();
  });

  it("rejects an unknown key with non-zero exit and helpful stderr", async () => {
    const r = await runDam(["config", "set", "unknown-key", "anything"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });

    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("unknown config key `unknown-key`");
    expect(r.stderr).toContain("server");
  });

  it("honors XDG_CONFIG_HOME when set", async () => {
    const xdg = await mkdtemp(join(tmpdir(), "dam-xdg-"));
    try {
      const r = await runDam(
        ["config", "set", "server", "https://example.test"],
        { HOME: home, XDG_CONFIG_HOME: xdg, PATH: process.env.PATH ?? "" },
      );

      expect(r.exitCode).toBe(0);
      const expected = join(xdg, "dam", "config.toml");
      expect(r.stdout).toContain(expected);
      const contents = await readFile(expected, "utf-8");
      expect(contents.trim()).toBe('server = "https://example.test"');
      // The HOME-derived path must NOT exist when XDG_CONFIG_HOME wins.
      await expect(readFile(configPath, "utf-8")).rejects.toThrow();
    } finally {
      await rm(xdg, { recursive: true, force: true });
    }
  });

  it("preserves unrelated top-level keys when overwriting server", async () => {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      'server = "https://old"\nfoo = "bar"\n',
      "utf-8",
    );

    const r = await runDam(["config", "set", "server", "https://new.test"], {
      HOME: home,
      PATH: process.env.PATH ?? "",
    });

    expect(r.exitCode).toBe(0);
    const contents = await readFile(configPath, "utf-8");
    expect(contents).toContain('foo = "bar"');
    expect(contents).toContain('server = "https://new.test"');
    expect(contents).not.toContain("https://old");
  });
});
