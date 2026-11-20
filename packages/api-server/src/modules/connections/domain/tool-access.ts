import type { Connection, ToolMode } from "api-server-api";
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

/* UNIT_BOUNDARY_DESCRIPTION: the tool modes an MCP Connection offers its owner, and none for any other Connection. All three only where the gateway reads the Connection's requests, which is the host of a Template that declares its tool access; allow all alone everywhere else. */
export function toolModesOf(
  connection: Connection,
  template: ToolAccessTemplate | null | undefined,
): readonly ToolMode[] {
  if (!isMcpConnection(connection)) return [];
  return template?.toolAccess ? ALL_TOOL_MODES : ["allow-all"];
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

/* UNIT_BOUNDARY_DESCRIPTION: the tool-access limit that applies to one request an Agent sends to a host, or null when nothing limits it. Only a granted Connection whose Template declares tool access for that host can limit a request. A request that names such a Connection gets that Connection's own mode. Any other request can still leave with a granted credential, because the gateway adds one where nothing contests the host, so it gets the strictest mode: read only before needs approval, since read only refuses at once and never asks a person for an approval they did not expect. */
export function toolAccessFor(
  granted: readonly Connection[],
  templateOf: (templateId: string) => ToolAccessTemplate | null | undefined,
  request: { host: string; connectionId: string | null },
): ToolAccessLimit | null {
  const declaring = granted.flatMap((connection) => {
    const template = templateOf(connection.templateId);
    return template?.toolAccess?.host === request.host
      ? [{ connection, template, mode: toolModeOf(connection, template) }]
      : [];
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
