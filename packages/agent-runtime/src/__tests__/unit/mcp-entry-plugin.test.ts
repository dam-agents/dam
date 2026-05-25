import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { createMcpEntryPlugin } from "../../modules/runtime-channel/drivers/mcp-entry-plugin.js";

const fixtureDirs: string[] = [];
function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-entry-"));
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

describe("mcp-entry plugin", () => {
  const validBinding = {
    impl: "mcp-entry",
    path: "$HOME/.mcp.json",
    format: "json",
    mergeMode: "key-targeted",
    keyPath: "mcpServers",
  } as const;

  it("refuses to bind a kind other than 'mcp-entry'", () => {
    const plugin = createMcpEntryPlugin();
    expect(() => plugin.bind("file", validBinding)).toThrow(
      /does not handle kind/,
    );
  });

  it("validates binding config at bind time", () => {
    const plugin = createMcpEntryPlugin();
    expect(() => plugin.bind("mcp-entry", { impl: "mcp-entry" })).toThrow(
      /invalid binding/,
    );
  });

  it("writes entries into the bound keyPath", async () => {
    const home = mkTmp();
    const plugin = createMcpEntryPlugin();
    const handler = plugin.bind("mcp-entry", validBinding);
    await handler(
      [
        {
          kind: "mcp-entry",
          name: "platform-outbound",
          url: "https://example.com/mcp",
        },
        {
          kind: "mcp-entry",
          name: "another",
          url: "https://example.com/two",
          headers: { Authorization: "Bearer t" },
        },
      ],
      ctx(home),
    );
    const written = JSON.parse(
      readFileSync(join(home, ".mcp.json"), "utf8"),
    ) as { mcpServers: Record<string, { type: string; url: string }> };
    expect(written.mcpServers["platform-outbound"]).toEqual({
      type: "http",
      url: "https://example.com/mcp",
    });
    expect(written.mcpServers["another"]).toMatchObject({
      type: "http",
      url: "https://example.com/two",
      headers: { Authorization: "Bearer t" },
    });
  });
});
