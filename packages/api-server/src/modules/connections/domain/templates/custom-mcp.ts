import { z } from "zod";
import type { ConnectionTemplate } from "../connection-template.js";

/**
 * Custom MCP server (ADR-051). User-typed integration:
 *   - URL of the MCP endpoint (the platform's egress allowlist permits
 *     this host).
 *   - One of three auth modes: none, bearer (header value as one secret),
 *     or oauth (deferred for now — uses Custom OAuth template).
 *
 * Emits:
 *   - `egress-host <urlHost>` — agent's outbound allowlist.
 *   - `mcp-entry <name>` — the agent's MCP config file.
 */
const inputsSchema = z.object({
  url: z.string().url(),
  authMode: z.enum(["none", "bearer"]).default("none"),
  /** Bearer token — only used when authMode === "bearer". */
  token: z.string().min(1).optional(),
  /** Display name in the MCP config (default: derive from URL host). */
  name: z.string().min(1).optional(),
});

type Inputs = z.infer<typeof inputsSchema>;

export function createCustomMcpTemplate(): ConnectionTemplate<Inputs> {
  return {
    id: "custom-mcp",
    name: "Custom MCP server",
    category: "mcp",
    isCustom: true,
    description: "Add an MCP server by URL with optional bearer auth.",
    iconSlug: "mcp",
    authKinds: ["none", "header"],
    contributedKinds: ["egress-host", "mcp-entry"],
    inputs: inputsSchema,

    build({ inputs, mintSecretRef }) {
      const url = new URL(inputs.url);
      const host = url.host;
      const name = (inputs.name ?? host.replace(/[^a-z0-9-]/gi, "-")).slice(
        0,
        48,
      );

      if (inputs.authMode === "bearer") {
        if (!inputs.token) {
          throw new Error("authMode=bearer requires a token");
        }
        const secretPath = mintSecretRef(`connection:mcp:${name}`);
        const tokenRef = { ...secretPath, field: "token" };
        return {
          auth: {
            kind: "header",
            valueRef: tokenRef,
            headerName: "Authorization",
            valueFormat: "Bearer {value}",
          },
          contributions: [
            { kind: "egress-host", host },
            {
              kind: "mcp-entry",
              name,
              url: inputs.url,
              headers: {
                Authorization: "Bearer dummy-placeholder",
              },
            },
          ],
          secrets: new Map([[secretPath.path, { token: inputs.token }]]),
          defaultName: name,
        };
      }

      return {
        auth: { kind: "none" },
        contributions: [
          { kind: "egress-host", host },
          { kind: "mcp-entry", name, url: inputs.url },
        ],
        secrets: new Map(),
        defaultName: name,
      };
    },

    toView() {
      return {
        id: "custom-mcp",
        name: "Custom MCP server",
        category: "mcp",
        isCustom: true,
        description: "Add an MCP server by URL with optional bearer auth.",
        iconSlug: "mcp",
        authKinds: ["none", "header"],
        contributedKinds: ["egress-host", "mcp-entry"],
      };
    },
  };
}
