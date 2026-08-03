import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFileOps,
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
    createFileOps().apply(new Map([[target, fragments]]), {
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
