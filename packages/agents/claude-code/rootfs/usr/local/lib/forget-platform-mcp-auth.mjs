/**
 * UNIT_BOUNDARY_DESCRIPTION: Claude Code caches a server that answered as if it
 * needs authentication for 15 minutes in ~/.claude/mcp-needs-auth-cache.json,
 * and skips that server until the entry expires. One mesh blip answers the
 * platform's own MCP server with a 403, and every session for the next 15
 * minutes then runs without the platform's tools — schedules, artifacts,
 * sub-agents, channel messaging — while the agent tells the user to authorise a
 * server the platform provides. So each session drops the platform's servers
 * from that cache before it connects them. A server of the agent's own stays: a
 * person may have signed it in, and a connector cannot be signed in to from
 * the machine at all.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PLATFORM_SERVERS = ["platform-outbound", "knowledge-bases"];
const path = join(
  process.env.HOME ?? "",
  ".claude",
  "mcp-needs-auth-cache.json",
);

let cache;
try {
  cache = JSON.parse(readFileSync(path, "utf8"));
} catch {
  process.exit(0);
}
if (typeof cache !== "object" || cache === null || Array.isArray(cache)) {
  process.exit(0);
}
const kept = Object.fromEntries(
  Object.entries(cache).filter(([name]) => !PLATFORM_SERVERS.includes(name)),
);
if (Object.keys(kept).length === Object.keys(cache).length) process.exit(0);
const staged = `${path}.${process.pid}`;
writeFileSync(staged, JSON.stringify(kept));
renameSync(staged, path);
