import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Contribution } from "api-server-api";
import type { Driver, DriverContext } from "./types.js";

type McpEntryContribution = Extract<Contribution, { kind: "mcp-entry" }>;

/** Built-in `mcp-entry` driver. Maintains `.mcp.json` at the agent's
 *  HOME, upserting (or removing — when entry is the empty object) one
 *  MCP server entry under `mcpServers`. */
export const mcpEntryDriver: Driver<McpEntryContribution> = {
  kind: "mcp-entry",
  async apply(c, ctx) {
    const path = join(ctx.agentHome, ".mcp.json");
    let json: { mcpServers?: Record<string, unknown> } = {};
    try {
      const raw = await readFile(path, "utf8");
      json = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    } catch {
      // Missing or unparseable — start fresh. Same shape the existing
      // platform-outbound boot-write uses (`server.ts`).
    }
    const servers = (json.mcpServers ?? {}) as Record<string, unknown>;
    if (Object.keys(c.entry).length === 0) {
      delete servers[c.name];
    } else {
      servers[c.name] = c.entry;
    }
    json.mcpServers = servers;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(json, null, 2) + "\n", "utf8");
  },
};
