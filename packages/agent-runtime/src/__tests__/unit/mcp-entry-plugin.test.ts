import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
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

  it("keys the URL under `urlKey` when set (Bob 1.x's httpUrl dialect)", async () => {
    await bind({ urlKey: "httpUrl" })(
      [entry("outbound", "http://hs/mcp")],
      ctx,
    );
    expect(readConfig(".bob/settings/mcp.json").mcpServers).toEqual({
      outbound: { httpUrl: "http://hs/mcp" },
    });
  });

  it("merges `extraFields` into every entry (Bob 2.0's transportType)", async () => {
    await bind({ extraFields: { transportType: "http" } })(
      [entry("outbound", "http://hs/mcp")],
      ctx,
    );
    expect(readConfig(".bob/settings/mcp.json").mcpServers).toEqual({
      outbound: {
        type: "http",
        url: "http://hs/mcp",
        transportType: "http",
      },
    });
  });

  it("rejects an `extraFields` key the driver builds itself", () => {
    expect(() => bind({ extraFields: { url: "" } })).toThrow(/cannot be set/);
    expect(() =>
      bind({ urlKey: "httpUrl", extraFields: { httpUrl: "x" } }),
    ).toThrow(/cannot be set/);
  });

  it("reserves only what the active branch builds", async () => {
    await bind({ urlKey: "httpUrl", extraFields: { type: "sse" } })(
      [entry("outbound", "http://hs/mcp")],
      ctx,
    );
    expect(readConfig(".bob/settings/mcp.json").mcpServers.outbound).toEqual({
      httpUrl: "http://hs/mcp",
      type: "sse",
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

  /**
   * TEST_SCENARIO: Codex reads MCP servers only from `[mcp_servers.<name>]` in
   * its own config.toml, as `url` plus `http_headers`. The same file holds the
   * user's own settings and servers, so the driver must rewrite only its own
   * entries and keep every other key.
   */
  it("writes TOML entries in Codex's field names and keeps the rest of the file", async () => {
    const target = join(home, ".codex/config.toml");
    const handler = bind({
      path: "$HOME/.codex/config.toml",
      format: "toml",
      keyPath: "mcp_servers",
      urlKey: "url",
      headersKey: "http_headers",
    });
    await handler([entry("platform-outbound", "http://hs/mcp")], ctx);
    writeFileSync(
      target,
      'model = "gpt-5"\n' +
        readFileSync(target, "utf8") +
        '\n[mcp_servers.user-own]\ncommand = "node"\n',
    );

    await handler(
      [
        entry("platform-outbound", "http://hs/mcp"),
        {
          kind: "mcp-entry",
          name: "linear",
          url: "https://mcp.linear.app/mcp",
          headers: { Authorization: "Bearer dummy-placeholder" },
        },
      ],
      ctx,
    );
    expect(parseToml(readFileSync(target, "utf8"))).toEqual({
      model: "gpt-5",
      mcp_servers: {
        "platform-outbound": { url: "http://hs/mcp" },
        linear: {
          url: "https://mcp.linear.app/mcp",
          http_headers: { Authorization: "Bearer dummy-placeholder" },
        },
        "user-own": { command: "node" },
      },
    });

    await handler([entry("platform-outbound", "http://hs/mcp")], ctx);
    expect(parseToml(readFileSync(target, "utf8")).mcp_servers).toEqual({
      "platform-outbound": { url: "http://hs/mcp" },
      "user-own": { command: "node" },
    });
  });

  it("rejects an `extraFields` key that names the configured headers key", () => {
    expect(() =>
      bind({ headersKey: "http_headers", extraFields: { http_headers: "" } }),
    ).toThrow(/cannot be set/);
  });
});
