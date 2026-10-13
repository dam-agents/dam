import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDam, spawnDam } from "./run-dam.js";

describe("dam config set (integration)", () => {
  let home: string;
  let configPath: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-cfg-set-"));
    configPath = join(home, ".config", "dam", "config.toml");
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  afterAll(async () => {});

  it("writes a valid TOML file with the server key", async () => {
    const r = await spawnDam(
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

    await expect(readFile(configPath, "utf-8")).rejects.toThrow();
  });

  it("rejects a non-http(s) URL", async () => {
    const r = await runDam(["config", "set", "server", "file:///etc/passwd"], {
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
      const r = await spawnDam(
        ["config", "set", "server", "https://example.test"],
        { HOME: home, XDG_CONFIG_HOME: xdg, PATH: process.env.PATH ?? "" },
      );

      expect(r.exitCode).toBe(0);
      const expected = join(xdg, "dam", "config.toml");
      expect(r.stdout).toContain(expected);
      const contents = await readFile(expected, "utf-8");
      expect(contents.trim()).toBe('server = "https://example.test"');
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
