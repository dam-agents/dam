import type { Connection, ConnectionTool, ToolMode } from "api-server-api";
import type { ConnectionTemplate } from "./connection-template.js";

export type ToolAccessTemplate = Pick<
  ConnectionTemplate,
  "toolAccess" | "defaultToolMode"
>;

export type LimitingToolMode = Exclude<ToolMode, "allow-all">;

export interface ToolAccessLimit {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly templateId: string;
  readonly mode: LimitingToolMode;
  readonly readTools: readonly string[];
}

export interface McpServer {
  readonly url: string;
  readonly host: string;
  readonly injectHost: string;
  readonly headerName: string;
  readonly valueFormat: string;
}

export type McpToolListOutcome =
  | { readonly ok: true; readonly tools: readonly ConnectionTool[] }
  | { readonly ok: false; readonly reason: string };

/* UNIT_BOUNDARY_DESCRIPTION: reads the tools an MCP server lists, with the credential the caller passes as request headers. A failure is an outcome with a short reason the owner can read, not a throw. */
export interface McpToolLister {
  list(url: URL, headers: Record<string, string>): Promise<McpToolListOutcome>;
}

const ALL_TOOL_MODES: readonly ToolMode[] = [
  "allow-all",
  "read-only",
  "needs-approval",
];

/* UNIT_BOUNDARY_DESCRIPTION: the tool mode a Connection is in: the one it stores, else its Template's default, else allow all. */
export function toolModeOf(
  connection: Connection,
  template: ToolAccessTemplate | null | undefined,
): ToolMode {
  return (
    connection.toolAccess?.mode ?? template?.defaultToolMode ?? "allow-all"
  );
}

export function isMcpConnection(connection: Connection): boolean {
  return connection.contributions.some((c) => c.kind === "mcp-entry");
}

/* UNIT_BOUNDARY_DESCRIPTION: the MCP server of a Connection whose requests the gateway can read: the address of its MCP entry, and the entry that injects its credential on that address's host. Only a Connection with a Secret injects a credential, so the gateway terminates its TLS and can send each request's body to the check. Null for a Connection with no MCP entry, and for one with no auth, whose requests pass the gateway unread. */
export function mcpServerOf(
  connection: Pick<Connection, "auth" | "contributions">,
): McpServer | null {
  if (connection.auth.kind === "none") return null;
  for (const entry of connection.contributions) {
    if (entry.kind !== "mcp-entry") continue;
    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      continue;
    }
    const inject = connection.contributions.find(
      (c) =>
        c.kind === "egress-inject" &&
        (c.host.toLowerCase() === url.host ||
          c.host.toLowerCase() === url.hostname),
    );
    if (inject?.kind !== "egress-inject") continue;
    return {
      url: entry.url,
      host: url.hostname,
      injectHost: inject.host,
      headerName: inject.headerName,
      valueFormat: inject.valueFormat,
    };
  }
  return null;
}

/* UNIT_BOUNDARY_DESCRIPTION: the tool modes an MCP Connection offers its owner, and none for any other Connection. All three where the gateway reads the Connection's requests, which is every MCP Connection with a Secret; allow all alone on one with no auth. */
export function toolModesOf(connection: Connection): readonly ToolMode[] {
  if (!isMcpConnection(connection)) return [];
  return mcpServerOf(connection) ? ALL_TOOL_MODES : ["allow-all"];
}

/* UNIT_BOUNDARY_DESCRIPTION: the tools as a Connection stores them. Where the Template declares its own read list, as the Slack Account does, that list decides which tools read, whatever hints the server sets. */
export function storedToolsOf(
  listed: readonly ConnectionTool[],
  template: ToolAccessTemplate | null | undefined,
): ConnectionTool[] {
  const readTools = template?.toolAccess?.readTools;
  return listed.map((tool) => ({
    name: tool.name,
    readOnly: readTools ? readTools.includes(tool.name) : tool.readOnly,
  }));
}

/* UNIT_BOUNDARY_DESCRIPTION: the tools a Connection in read only may call: the Template's own read list where it declares one, else the stored tools the server marks as reading. A tool neither names is not a read tool. */
export function readToolsOf(
  connection: Connection,
  template: ToolAccessTemplate | null | undefined,
): readonly string[] {
  if (template?.toolAccess) return template.toolAccess.readTools;
  return (connection.toolAccess?.tools ?? []).flatMap((tool) =>
    tool.readOnly ? [tool.name] : [],
  );
}

/* UNIT_BOUNDARY_DESCRIPTION: the tool-access limit that applies to one request an Agent sends to a host, or null when nothing limits it. Only a granted Connection whose MCP server is on that host can limit a request. A request that names such a Connection gets that Connection's own mode. Any other request can still leave with a granted credential, because the gateway adds one where nothing contests the host, so it gets the strictest mode: read only before needs approval, since read only refuses at once and never asks a person for an approval they did not expect. */
export function toolAccessFor(
  granted: readonly Connection[],
  templateOf: (templateId: string) => ToolAccessTemplate | null | undefined,
  request: { host: string; connectionId: string | null },
): ToolAccessLimit | null {
  const declaring = granted.flatMap((connection) => {
    if (mcpServerOf(connection)?.host !== request.host) return [];
    const template = templateOf(connection.templateId);
    return [{ connection, template, mode: toolModeOf(connection, template) }];
  });
  const subject =
    declaring.find((d) => d.connection.id === request.connectionId) ??
    declaring.find((d) => d.mode === "read-only") ??
    declaring.find((d) => d.mode === "needs-approval");
  if (!subject || subject.mode === "allow-all") return null;
  return {
    connectionId: subject.connection.id,
    connectionName: subject.connection.name,
    templateId: subject.connection.templateId,
    mode: subject.mode,
    readTools: readToolsOf(subject.connection, subject.template),
  };
}

/* UNIT_BOUNDARY_DESCRIPTION: a limit the Agent holds on any host, or null when every granted MCP Connection allows all. It is the strictest one, for a request whose real host the gateway did not say. */
export function heldToolAccess(
  granted: readonly Connection[],
  templateOf: (templateId: string) => ToolAccessTemplate | null | undefined,
): ToolAccessLimit | null {
  const hosts = new Set(
    granted.flatMap((connection) => mcpServerOf(connection)?.host ?? []),
  );
  const limits = [...hosts].flatMap(
    (host) =>
      toolAccessFor(granted, templateOf, { host, connectionId: null }) ?? [],
  );
  return (
    limits.find((limit) => limit.mode === "read-only") ?? limits[0] ?? null
  );
}
