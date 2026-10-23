import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { secretlessConnectionCreateInputSchema } from "api-server-api";
import { json, run } from "../../core/mcp-tool-result.js";
import type { AgentSecretRequests } from "./services/agent-secret-requests.js";

const LIST_DESCRIPTION =
  "List the connections you may ask your owner to create or to give a new secret: `templates` are the kinds whose secret the platform sends only to the hosts shown, and `connections` are the ones granted to you that hold a secret. Call this before request_connection_secret.";

const REQUEST_DESCRIPTION = `Ask your owner to type a secret (an API key, a token, a private key) on a page of the platform's web app, instead of in a chat. You never see the secret: the platform stores it, injects it on the wire, and gives you a placeholder. With \`connection\` the owner creates a new connection from a template of list_connection_templates and it is granted to you once saved: { templateId, name, authKind, ... } with every input but the secret (a header template takes \`configInputs\`; a GitHub App takes \`appId\` and \`installationId\`). With \`connectionId\` the owner replaces the secret of a connection granted to you. Returns a link that works once, for ten minutes, and only for your owner signed in: give it to your owner with one sentence on what the secret is for. Never ask for the secret itself in any message. Then call connection_secret_status until it is no longer pending.`;

const STATUS_DESCRIPTION =
  "Read the state of a secret request you made: pending, saved (with the connection's id, whether it was granted to you and the result of the platform's check of the secret), cancelled by your owner, or expired. The secret itself is never returned. A connection granted to you reaches your environment within a minute.";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the platform MCP tools through which an Agent
 * asks its owner for a connection's secret on the web app's secret-entry
 * page, the same page the CLI opens. The Agent hands over every input but the
 * secret and gets a single-use link for its owner; it reads back only the
 * request's state, never the secret.
 */
export function registerConnectionSecretTools(
  server: McpServer,
  deps: { requests: AgentSecretRequests },
): void {
  server.tool("list_connection_templates", LIST_DESCRIPTION, {}, () =>
    run(async () => json(await deps.requests.options())),
  );

  server.tool(
    "request_connection_secret",
    REQUEST_DESCRIPTION,
    {
      connection: secretlessConnectionCreateInputSchema
        .optional()
        .describe("A new connection, every input but the secret."),
      connectionId: z
        .string()
        .min(1)
        .optional()
        .describe("A connection granted to you whose secret is replaced."),
    },
    (args) =>
      run(async () => {
        if (
          (args.connection === undefined) ===
          (args.connectionId === undefined)
        ) {
          throw new Error("pass either connection or connectionId");
        }
        return json(
          await deps.requests.request(
            args.connection
              ? { action: "create", connection: args.connection }
              : { action: "update", connectionId: args.connectionId! },
          ),
        );
      }),
  );

  server.tool(
    "connection_secret_status",
    STATUS_DESCRIPTION,
    { requestId: z.string().min(1).max(128) },
    (args) => run(async () => json(await deps.requests.status(args.requestId))),
  );
}
