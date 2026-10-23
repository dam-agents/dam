import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, run } from "../../core/mcp-tool-result.js";
import type { AgentSecretRequests } from "./services/agent-secret-requests.js";

const DESCRIPTION =
  "Have your owner type a secret (API key, token, private key) on a web page instead of in a chat; you never see it, and a new connection is granted to you. `options` lists the templates you may ask for and your connections that hold a secret. `request` with templateId, name and inputs (a new connection) or connectionId (a new secret) returns a one-time link for your owner only; hand it over and never ask for the secret itself. `status` with requestId says pending, saved, cancelled or expired.";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the platform MCP tool through which an Agent
 * asks its owner for a connection's secret on the web app's secret-entry
 * page, the same page the CLI opens. One tool with an action keeps the
 * Agent's tool list short; the inputs are checked on the server.
 */
export function registerConnectionSecretTool(
  server: McpServer,
  deps: { requests: AgentSecretRequests },
): void {
  server.tool(
    "connection_secret",
    DESCRIPTION,
    {
      action: z.enum(["options", "request", "status"]),
      templateId: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      inputs: z.record(z.string(), z.string()).optional(),
      connectionId: z.string().min(1).optional(),
      requestId: z.string().min(1).max(128).optional(),
    },
    (args) =>
      run(async () => {
        if (args.action === "options") {
          return json(await deps.requests.options());
        }
        if (args.action === "status") {
          if (!args.requestId) throw new Error("status needs requestId");
          return json(await deps.requests.status(args.requestId));
        }
        if (args.connectionId) {
          return json(
            await deps.requests.request({
              action: "update",
              connectionId: args.connectionId,
            }),
          );
        }
        if (!args.templateId || !args.name) {
          throw new Error("request needs templateId and name, or connectionId");
        }
        return json(
          await deps.requests.requestNew({
            templateId: args.templateId,
            name: args.name,
            ...(args.inputs ? { inputs: args.inputs } : {}),
          }),
        );
      }),
  );
}
