import type {
  Connection,
  ConnectionTemplateToolAccess,
  ConnectionTool,
  GrantToolAccess,
  ToolMode,
  ToolRule,
} from "api-server-api";
import type { ConnectionTemplate } from "./connection-template.js";

export type ToolAccessTemplate = Pick<
  ConnectionTemplate,
  "toolAccess" | "defaultToolMode"
>;

/* UNIT_BOUNDARY_DESCRIPTION: one Connection granted to an Agent, with the tool access stored on that grant, or null when the grant stores none and follows its Connection's tool mode. */
export interface GrantedConnection {
  readonly connection: Connection;
  readonly toolAccess: GrantToolAccess | null;
}

export interface LimitingConnection {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly templateId: string;
}

/* UNIT_BOUNDARY_DESCRIPTION: what limits the tool calls of one request. The fields name the Connection that a refusal names when it is about no single tool. `ruleOf` answers the rule of one tool, and the Connection whose grant gave that rule. */
export interface ToolAccessLimit extends LimitingConnection {
  ruleOf(tool: string): {
    readonly rule: ToolRule;
    readonly connection: LimitingConnection;
  };
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

export function isMcpConnection(
  connection: Pick<Connection, "contributions">,
): boolean {
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
export function toolModesOf(
  connection: Pick<Connection, "auth" | "contributions">,
): readonly ToolMode[] {
  if (!isMcpConnection(connection)) return [];
  return mcpServerOf(connection) ? ALL_TOOL_MODES : ["allow-all"];
}

/* UNIT_BOUNDARY_DESCRIPTION: the tool modes a Template offers at connect, for a Template that makes an MCP Connection, and none for any other. A custom MCP server's address comes with the create, so its Template is known as MCP by its category. One with no auth offers allow all alone; the modes the Connection really offers are decided again from the Connection the create builds. */
export function templateToolAccessOf(
  template: Pick<
    ConnectionTemplate,
    "category" | "contributions" | "authKind" | "defaultToolMode"
  >,
): ConnectionTemplateToolAccess | undefined {
  const makesMcp = template.category === "mcp" || isMcpConnection(template);
  if (!makesMcp) return undefined;
  return {
    defaultMode: template.defaultToolMode ?? "allow-all",
    modes: template.authKind === "none" ? ["allow-all"] : ALL_TOOL_MODES,
  };
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

/* UNIT_BOUNDARY_DESCRIPTION: the tools a Connection in read only may call, and a Connection in needs approval calls without asking: the Template's own read list where it declares one, else the stored tools the server marks as reading. A tool neither names is not a read tool. */
export function readToolsOf(
  connection: Connection,
  template: ToolAccessTemplate | null | undefined,
): readonly string[] {
  if (template?.toolAccess) return template.toolAccess.readTools;
  return (connection.toolAccess?.tools ?? []).flatMap((tool) =>
    tool.readOnly ? [tool.name] : [],
  );
}

const STRICTNESS: Readonly<Record<ToolRule, number>> = {
  allow: 0,
  ask: 1,
  block: 2,
};

function stricterRule(a: ToolRule, b: ToolRule): ToolRule {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

const ACCESS_OF_MODE: Readonly<Record<ToolMode, GrantToolAccess>> = {
  "read-only": { read: "allow", write: "block", overrides: {} },
  "needs-approval": { read: "allow", write: "ask", overrides: {} },
  "allow-all": { read: "allow", write: "allow", overrides: {} },
};

/* UNIT_BOUNDARY_DESCRIPTION: the tool access that a tool mode stands for, with no overrides. A grant that stores no access of its own gets the access of its Connection's mode, so it behaves as the mode did before access moved to the grant. */
export function accessOfMode(mode: ToolMode): GrantToolAccess {
  return ACCESS_OF_MODE[mode];
}

/* UNIT_BOUNDARY_DESCRIPTION: the tool access a new grant starts with while the owner has the `mcp-tool-approval` feature, for a Connection whose requests the gateway reads. Each group takes the stricter rule of two: the safe start (read only where the Template's default mode is read only, as on the Slack Account, else reads allowed and every other tool asking) and the access of the Connection's tool mode. So a new grant never starts looser than the mode the owner chose. */
export function startingAccessOf(
  connection: Connection,
  template: ToolAccessTemplate | null | undefined,
): GrantToolAccess {
  const safe = accessOfMode(
    template?.defaultToolMode === "read-only" ? "read-only" : "needs-approval",
  );
  const chosen = accessOfMode(toolModeOf(connection, template));
  return {
    read: stricterRule(safe.read, chosen.read),
    write: stricterRule(safe.write, chosen.write),
    overrides: {},
  };
}

export const MAX_TOOL_ACCESS_OVERRIDES = 500;
export const MAX_TOOL_NAME_LENGTH = 256;

/* UNIT_BOUNDARY_DESCRIPTION: a tool access as it is stored: an override equal to the rule of its tool's group says nothing, so it is dropped. The group of a tool is the read tools for a read tool, else every other tool. */
export function normalizedAccess(
  access: GrantToolAccess,
  readTools: readonly string[],
): GrantToolAccess {
  const overrides = Object.fromEntries(
    Object.entries(access.overrides).filter(
      ([tool, rule]) =>
        rule !== (readTools.includes(tool) ? access.read : access.write),
    ),
  );
  return { read: access.read, write: access.write, overrides };
}

/* UNIT_BOUNDARY_DESCRIPTION: the tool access of one grant: the one it stores, else the access of its Connection's tool mode. */
export function grantAccessOf(
  grant: GrantedConnection,
  template: ToolAccessTemplate | null | undefined,
): GrantToolAccess {
  return (
    grant.toolAccess ?? accessOfMode(toolModeOf(grant.connection, template))
  );
}

/* UNIT_BOUNDARY_DESCRIPTION: the rule of one tool in a tool access: its override, else the rule of the read tools for a read tool, else the rule of every other tool. A tool the stored list does not name is not a read tool. */
export function ruleOfTool(
  access: GrantToolAccess,
  readTools: readonly string[],
  tool: string,
): ToolRule {
  if (Object.hasOwn(access.overrides, tool)) return access.overrides[tool]!;
  return readTools.includes(tool) ? access.read : access.write;
}

/* UNIT_BOUNDARY_DESCRIPTION: whether a tool access limits any tool call, that is whether any of its rules is other than allow. */
export function limitsToolCalls(access: GrantToolAccess): boolean {
  return [access.read, access.write, ...Object.values(access.overrides)].some(
    (rule) => rule !== "allow",
  );
}

function blocksAny(access: GrantToolAccess): boolean {
  return [access.read, access.write, ...Object.values(access.overrides)].some(
    (rule) => rule === "block",
  );
}

interface GrantOnHost {
  readonly connection: LimitingConnection;
  readonly access: GrantToolAccess;
  readonly readTools: readonly string[];
}

function limitingConnectionOf(connection: Connection): LimitingConnection {
  return {
    connectionId: connection.id,
    connectionName: connection.name,
    templateId: connection.templateId,
  };
}

function grantsOnHost(
  granted: readonly GrantedConnection[],
  templateOf: (templateId: string) => ToolAccessTemplate | null | undefined,
  host: string,
): (GrantOnHost & { readonly id: string })[] {
  return granted.flatMap((grant) => {
    if (mcpServerOf(grant.connection)?.host !== host) return [];
    const template = templateOf(grant.connection.templateId);
    return [
      {
        id: grant.connection.id,
        connection: limitingConnectionOf(grant.connection),
        access: grantAccessOf(grant, template),
        readTools: readToolsOf(grant.connection, template),
      },
    ];
  });
}

/* UNIT_BOUNDARY_DESCRIPTION: the tool-access limit that applies to one request an Agent sends to a host, or null when nothing limits it. Only a granted Connection whose MCP server is on that host can limit a request, and only when its grant has a rule other than allow. A request that names such a Connection gets that grant's rules. Any other request can still leave with a granted credential, because the gateway adds one where nothing contests the host, so each of its tools gets the strictest rule among the Agent's grants there: block, then ask, then allow. Block comes first because it refuses at once and never asks a person for an approval they did not expect. */
export function toolAccessFor(
  granted: readonly GrantedConnection[],
  templateOf: (templateId: string) => ToolAccessTemplate | null | undefined,
  request: { host: string; connectionId: string | null },
): ToolAccessLimit | null {
  const onHost = grantsOnHost(granted, templateOf, request.host);
  const named = onHost.find((grant) => grant.id === request.connectionId);
  const subjects = named ? [named] : onHost;
  const limiting = subjects.filter((grant) => limitsToolCalls(grant.access));
  const shown =
    limiting.find((grant) => blocksAny(grant.access)) ?? limiting[0];
  if (!shown) return null;
  return {
    ...shown.connection,
    ruleOf(tool) {
      let strictest: { rule: ToolRule; connection: LimitingConnection } = {
        rule: "allow",
        connection: shown.connection,
      };
      for (const grant of subjects) {
        const rule = ruleOfTool(grant.access, grant.readTools, tool);
        if (STRICTNESS[rule] > STRICTNESS[strictest.rule])
          strictest = { rule, connection: grant.connection };
      }
      return strictest;
    },
  };
}

/* UNIT_BOUNDARY_DESCRIPTION: a granted Connection whose grant has a rule other than allow, on any host, or null when every grant the gateway reads allows every tool. A grant with a block comes first. It is for a request whose real host the gateway did not say. */
export function heldToolAccess(
  granted: readonly GrantedConnection[],
  templateOf: (templateId: string) => ToolAccessTemplate | null | undefined,
): LimitingConnection | null {
  const limiting = granted.flatMap((grant) => {
    if (!mcpServerOf(grant.connection)) return [];
    const access = grantAccessOf(
      grant,
      templateOf(grant.connection.templateId),
    );
    return limitsToolCalls(access)
      ? [{ connection: limitingConnectionOf(grant.connection), access }]
      : [];
  });
  const shown =
    limiting.find((grant) => blocksAny(grant.access)) ?? limiting[0];
  return shown?.connection ?? null;
}
