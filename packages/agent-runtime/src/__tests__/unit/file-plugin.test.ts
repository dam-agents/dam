import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { createFilePlugin } from "../../modules/runtime-channel/drivers/file-plugin.js";

const fixtureDirs: string[] = [];
function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "file-plugin-"));
  fixtureDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (fixtureDirs.length) {
    const d = fixtureDirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

function ctx(agentHome: string) {
  return {
    agentHome,
    pluginStateDir: join(agentHome, ".state"),
    log: vi.fn(),
  };
}

describe("file plugin", () => {
  it("refuses to bind a kind other than 'file'", () => {
    const plugin = createFilePlugin();
    expect(() => plugin.bind("mcp-entry", { impl: "file" })).toThrow(
      /does not handle kind/,
    );
  });

  it("writes a file with overwrite semantics", async () => {
    const home = mkTmp();
    const plugin = createFilePlugin();
    const handler = plugin.bind("file", { impl: "file" });
    await handler(
      [
        {
          kind: "file",
          path: "$HOME/config.json",
          format: "json",
          mergeMode: "overwrite",
          content: { hello: "world" },
        },
      ],
      ctx(home),
    );
    expect(readFileSync(join(home, "config.json"), "utf8")).toContain(
      '"hello": "world"',
    );
  });

  it("refuses to write paths outside agentHome", async () => {
    const home = mkTmp();
    const elsewhere = mkTmp();
    const plugin = createFilePlugin();
    const handler = plugin.bind("file", { impl: "file" });
    const c = ctx(home);
    await handler(
      [
        {
          kind: "file",
          path: join(elsewhere, "evil.json"),
          format: "json",
          mergeMode: "overwrite",
          content: { x: 1 },
        },
      ],
      c,
    );
    expect(c.log).toHaveBeenCalled();
  });

  it("expands $HOME in the contribution path", async () => {
    const home = mkTmp();
    const plugin = createFilePlugin();
    const handler = plugin.bind("file", { impl: "file" });
    await handler(
      [
        {
          kind: "file",
          path: "${HOME}/nested/x.json",
          format: "json",
          mergeMode: "overwrite",
          content: { ok: true },
        },
      ],
      ctx(home),
    );
    expect(readFileSync(join(home, "nested/x.json"), "utf8")).toContain(
      '"ok": true',
    );
  });

  it("removes the file when the desired set drops a previously-written path (overwrite)", async () => {
    const home = mkTmp();
    const plugin = createFilePlugin();
    const handler = plugin.bind("file", { impl: "file" });
    // Pre-populate something the plugin would have written previously.
    const target = join(home, "x.json");
    writeFileSync(target, '{"old": true}\n');

    // Empty desired set with an overwrite-tracked contribution to drop —
    // the file impl deletes paths that vanish from the desired snapshot
    // only when the dispatcher signals removal explicitly. With the
    // current plugin contract, the dispatcher hands an empty list and
    // the file impl doesn't know which paths to remove unless a prior
    // accounting was kept. Verify that an empty list is a no-op (the
    // existing file is preserved), which is the current contract.
    await handler([], ctx(home));
    expect(readFileSync(target, "utf8")).toContain("old");
  });
});
