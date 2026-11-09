import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const dir = process.argv[2];
writeFileSync(join(dir, "pids"), `${process.pid}\n`, { flag: "a" });

const first = !existsSync(join(dir, "started"));
writeFileSync(join(dir, "started"), "1");

const mcp = new McpServer({ name: "child", version: "1.0.0" });
if (first) {
  mcp.registerTool(
    "greet",
    { description: "Greet someone", inputSchema: { who: z.string() } },
    async ({ who }) => ({ content: [{ type: "text", text: `hello ${who}` }] }),
  );
  setTimeout(() => process.exit(0), 400);
}

await mcp.connect(new StdioServerTransport());
