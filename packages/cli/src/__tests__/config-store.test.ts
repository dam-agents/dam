import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTomlConfigStore } from "../modules/cli/infrastructure/config-store.js";

describe("TOML ConfigStore", () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cli-cfg-"));
    configPath = join(dir, "config.toml");
  });

  afterEach(async () => {
    // Best-effort cleanup. mkdtemp on macOS lives under /var/folders, no
    // crossover with the user's $HOME — see the reviewer-checklist guard.
    try {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("read on missing file returns Ok({})", async () => {
    const store = createTomlConfigStore(configPath);
    const r = await store.read();
    expect(r).toEqual({ ok: true, value: {} });
  });

  it("write then read round-trips a server value", async () => {
    const store = createTomlConfigStore(configPath);
    const w = await store.write({ server: "https://example.test" });
    expect(w.ok).toBe(true);

    const r = await store.read();
    expect(r).toEqual({ ok: true, value: { server: "https://example.test" } });
  });

  it("write preserves unrelated top-level keys in the file", async () => {
    // Simulate a user-edited file with extra top-level keys we don't own.
    await writeFile(
      configPath,
      'server = "https://old"\nfoo = "bar"\n',
      "utf-8",
    );
    const store = createTomlConfigStore(configPath);

    const w = await store.write({ server: "https://new" });
    expect(w.ok).toBe(true);

    const raw = await readFile(configPath, "utf-8");
    expect(raw).toContain('foo = "bar"');
    expect(raw).toContain('server = "https://new"');
    expect(raw).not.toContain('https://old');
  });

  it("malformed TOML returns Err(MalformedConfigError)", async () => {
    await writeFile(configPath, "this is = not [ valid toml", "utf-8");
    const store = createTomlConfigStore(configPath);

    const r = await store.read();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("malformed-config");
      expect(r.error.reason).toContain(configPath);
    }
  });

  it("write creates the parent directory when missing", async () => {
    const nested = join(dir, "nested", "deep", "config.toml");
    const store = createTomlConfigStore(nested);

    const w = await store.write({ server: "https://nested.test" });
    expect(w.ok).toBe(true);

    const r = await store.read();
    expect(r).toEqual({ ok: true, value: { server: "https://nested.test" } });
  });

});
