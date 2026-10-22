import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyFiles,
  type FileDesired,
  type FileOpsContext,
} from "../../modules/runtime-channel/infrastructure/file-ops.js";

describe("file-ops key-targeted merge", () => {
  let home: string;
  let target: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "file-ops-"));
    target = join(home, "config.json");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const frag = (over: Partial<FileDesired>): FileDesired => ({
    format: "json",
    mergeMode: "key-targeted",
    content: undefined,
    ...over,
  });
  const apply = (
    fragments: FileDesired[],
    onUnparseable?: FileOpsContext["onUnparseable"],
  ) =>
    applyFiles(new Map([[target, fragments]]), {
      agentHome: home,
      log: () => {},
      onUnparseable,
    });
  const read = () =>
    JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;

  it("sets a nested key, preserving existing and sibling keys", async () => {
    writeFileSync(
      target,
      JSON.stringify({ theme: "dark", permissions: { allow: ["x"] } }),
    );
    await apply([
      frag({ keyPath: "permissions.defaultMode", content: "plan" }),
    ]);
    expect(read()).toEqual({
      theme: "dark",
      permissions: { allow: ["x"], defaultMode: "plan" },
    });
  });

  it("delete fragment removes a key and prunes the emptied ancestor", async () => {
    writeFileSync(
      target,
      JSON.stringify({ keep: 1, permissions: { defaultMode: "plan" } }),
    );
    await apply([frag({ keyPath: "permissions.defaultMode", delete: true })]);
    expect(read()).toEqual({ keep: 1 });
  });

  it("onUnparseable 'throw' aborts and leaves the file untouched", async () => {
    writeFileSync(target, "{ not json");
    await expect(
      apply([frag({ keyPath: "a", content: 1 })], "throw"),
    ).rejects.toThrow();
    expect(readFileSync(target, "utf8")).toBe("{ not json");
  });

  it("default rewrite-aside moves an unparseable file to a sidecar and rewrites", async () => {
    writeFileSync(target, "{ not json");
    await apply([frag({ keyPath: "a", content: 1 })]);
    expect(read()).toEqual({ a: 1 });
    const sidecars = readdirSync(home).filter((f) => f.includes(".broken-"));
    expect(sidecars).toHaveLength(1);
    expect(readFileSync(join(home, sidecars[0]!), "utf8")).toBe("{ not json");
  });
});

describe("file-ops temporary file name", () => {
  let home: string;
  let target: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "file-ops-tmp-"));
    target = join(home, "settings.json");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const apply = (key: string) =>
    applyFiles(
      new Map([
        [
          target,
          [
            {
              format: "json" as const,
              mergeMode: "key-targeted" as const,
              keyPath: key,
              content: true,
            },
          ],
        ],
      ]),
      { agentHome: home, log: () => {} },
    );

  it("writes through a temporary name of its own process", async () => {
    writeFileSync(target, JSON.stringify({ theme: "dark" }));
    const own = `${target}.${process.pid}.tmp`;
    writeFileSync(own, "stale");
    await apply("mine");
    expect(existsSync(own)).toBe(false);
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({
      theme: "dark",
      mine: true,
    });
  });

  it("leaves the temporary file of another writer in place", async () => {
    writeFileSync(target, JSON.stringify({ theme: "dark" }));
    const theirs = `${target}.tmp`;
    writeFileSync(theirs, '{"hooks":"from a kit"}');
    await apply("mine");
    expect(readFileSync(theirs, "utf8")).toBe('{"hooks":"from a kit"}');
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({
      theme: "dark",
      mine: true,
    });
    expect(readdirSync(home).sort()).toEqual([
      "settings.json",
      "settings.json.tmp",
    ]);
  });
});

describe("file-ops removal of what the platform wrote", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "file-ops-rm-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const ctx = () => ({ agentHome: home, log: () => {} });

  it("a key-targeted delete removes literal top-level keys, dots included", async () => {
    const target = join(home, "hosts.yml");
    writeFileSync(target, "other.example.com:\n  user: me\n");
    const hosts: FileDesired = {
      format: "yaml",
      mergeMode: "key-targeted",
      content: { "github.com": { user: "work" } },
    };
    await applyFiles(new Map([[target, [hosts]]]), ctx());
    await applyFiles(
      new Map([
        [
          target,
          [
            {
              ...hosts,
              content: undefined,
              delete: true,
              keys: ["github.com"],
            },
          ],
        ],
      ]),
      ctx(),
    );
    expect(load(readFileSync(target, "utf8"))).toEqual({
      "other.example.com": { user: "me" },
    });
  });

  it("a delete against a file that is not there creates nothing", async () => {
    const target = join(home, "hosts.yml");
    await applyFiles(
      new Map([
        [
          target,
          [
            {
              format: "yaml",
              mergeMode: "key-targeted",
              content: undefined,
              delete: true,
              keys: ["github.com"],
            },
          ],
        ],
      ]),
      ctx(),
    );
    expect(existsSync(target)).toBe(false);
  });
});

describe("file-ops settings lock", () => {
  let home: string;
  let target: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "file-ops-lock-"));
    target = join(home, "settings.json");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const lock = () => `${target}.lock`;
  const apply = (
    key: string,
    content: unknown = true,
    onUnparseable?: FileOpsContext["onUnparseable"],
  ) =>
    applyFiles(
      new Map([
        [
          target,
          [
            {
              format: "json" as const,
              mergeMode: "key-targeted" as const,
              keyPath: key,
              content,
            },
          ],
        ],
      ]),
      { agentHome: home, log: () => {}, onUnparseable },
    );
  const read = () =>
    JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;

  it("reads the file after it takes the lock, so a change another writer lands while it waits survives", async () => {
    writeFileSync(target, JSON.stringify({ theme: "dark" }));
    writeFileSync(lock(), String(process.pid));
    const pending = apply("permissions.defaultMode", "plan");
    await new Promise((done) => setTimeout(done, 50));
    writeFileSync(
      target,
      JSON.stringify({
        theme: "dark",
        modelSettings: { opus: { autoCompactWindow: 1000 } },
      }),
    );
    rmSync(lock());
    await pending;
    expect(read()).toEqual({
      theme: "dark",
      modelSettings: { opus: { autoCompactWindow: 1000 } },
      permissions: { defaultMode: "plan" },
    });
    expect(existsSync(lock())).toBe(false);
  });

  it("refuses to write while another living writer holds the lock, and says why", async () => {
    writeFileSync(target, JSON.stringify({ theme: "dark" }));
    const holder = `${process.pid}:theirs`;
    writeFileSync(lock(), holder);
    await expect(apply("mine", true, "throw")).rejects.toThrow(
      /settings\.json\.lock stayed locked/,
    );
    expect(read()).toEqual({ theme: "dark" });
    expect(readFileSync(lock(), "utf8")).toBe(holder);
  });

  it("logs a lock it cannot take instead of failing a caller that is not strict", async () => {
    writeFileSync(target, JSON.stringify({ theme: "dark" }));
    writeFileSync(lock(), `${process.pid}:theirs`);
    const logs: string[] = [];
    await applyFiles(
      new Map([
        [
          target,
          [
            {
              format: "json" as const,
              mergeMode: "key-targeted" as const,
              keyPath: "mine",
              content: true,
            },
          ],
        ],
      ]),
      { agentHome: home, log: (line) => logs.push(line) },
    );
    expect(read()).toEqual({ theme: "dark" });
    expect(logs.join("\n")).toMatch(/settings\.json\.lock stayed locked/);
  });

  it("breaks a lock left behind by a writer that died inside its section", async () => {
    writeFileSync(target, JSON.stringify({ theme: "dark" }));
    const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
    writeFileSync(lock(), `${dead}:gone`);
    const longAgo = new Date(Date.now() - 60_000);
    utimesSync(lock(), longAgo, longAgo);
    await apply("mine");
    expect(read()).toEqual({ theme: "dark", mine: true });
    expect(existsSync(lock())).toBe(false);
  });
});
