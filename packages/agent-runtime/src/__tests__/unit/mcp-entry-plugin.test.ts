import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Contribution, DispatchContext } from "agent-runtime-api";
import { createMcpEntryPlugin } from "../../modules/runtime-channel/drivers/mcp-entry-plugin.js";

let home: string;
let ctx: DispatchContext;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mcp-entry-"));
  ctx = {
    agentHome: home,
    pluginStateDir: join(home, ".state"),
    log: () => {},
  };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const entry = (name: string, url: string): Contribution => ({
  kind: "mcp-entry",
  name,
  url,
});

const readConfig = (path: string) =>
  JSON.parse(readFileSync(join(home, path), "utf8")) as Record<
    string,
    Record<string, unknown>
  >;

const bind = (binding: Record<string, unknown>) =>
  createMcpEntryPlugin().bind!("mcp-entry", {
    impl: "mcp-entry",
    path: "$HOME/.bob/settings/mcp.json",
    keyPath: "mcpServers",
    ...binding,
  });

describe("mcp-entry plugin", () => {
  it("writes {type:'http',url} entries by default", async () => {
    await bind({})([entry("outbound", "http://hs/mcp")], ctx);
    expect(readConfig(".bob/settings/mcp.json").mcpServers).toEqual({
      outbound: { type: "http", url: "http://hs/mcp" },
    });
  });

  it("keys the URL under `urlKey` when set (Bob's httpUrl dialect)", async () => {
    await bind({ urlKey: "httpUrl" })(
      [entry("outbound", "http://hs/mcp")],
      ctx,
    );
    expect(readConfig(".bob/settings/mcp.json").mcpServers).toEqual({
      outbound: { httpUrl: "http://hs/mcp" },
    });
  });

  it("keeps headers alongside a urlKey entry", async () => {
    await bind({ urlKey: "httpUrl" })(
      [
        {
          kind: "mcp-entry",
          name: "outbound",
          url: "http://hs/mcp",
          headers: { "X-A": "1" },
        },
      ],
      ctx,
    );
    expect(readConfig(".bob/settings/mcp.json").mcpServers.outbound).toEqual({
      httpUrl: "http://hs/mcp",
      headers: { "X-A": "1" },
    });
  });

  it("preserves user-added servers and drops only its own stale entries", async () => {
    const handler = bind({ urlKey: "httpUrl" });
    await handler([entry("outbound", "http://hs/mcp")], ctx);
    const target = join(home, ".bob/settings/mcp.json");
    const onDisk = JSON.parse(readFileSync(target, "utf8"));
    onDisk.mcpServers["user-own"] = { command: "node", args: ["srv.mjs"] };
    writeFileSync(target, JSON.stringify(onDisk));

    await handler([entry("renamed", "http://hs/mcp2")], ctx);
    expect(readConfig(".bob/settings/mcp.json").mcpServers).toEqual({
      renamed: { httpUrl: "http://hs/mcp2" },
      "user-own": { command: "node", args: ["srv.mjs"] },
    });
  });
});
