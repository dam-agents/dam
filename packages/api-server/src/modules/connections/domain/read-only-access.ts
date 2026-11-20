import type { Connection } from "api-server-api";
import type { TemplateToolAccess } from "./connection-template.js";

export interface ReadOnlyAccess {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly readTools: readonly string[];
  readonly fullAccessLabel: string;
}

function hasFullAccess(connection: Connection): boolean {
  return (
    connection.auth.kind === "oauth" && connection.auth.fullAccess === true
  );
}

/* UNIT_BOUNDARY_DESCRIPTION: the read-only limit that applies to one request an Agent sends to a host, or null when nothing limits it. Only a granted Connection whose Template declares read tools for that host can limit a request. A request that names such a Connection gets that Connection's own choice. Any other request can still leave with a granted credential, because the gateway adds one where nothing contests the host, so it gets the strictest choice: the limit of the first read-only Connection. */
export function readOnlyAccessFor(
  granted: readonly Connection[],
  toolAccessOf: (templateId: string) => TemplateToolAccess | undefined,
  request: { host: string; connectionId: string | null },
): ReadOnlyAccess | null {
  const declaring = granted.flatMap((connection) => {
    const toolAccess = toolAccessOf(connection.templateId);
    return toolAccess && toolAccess.host === request.host
      ? [{ connection, toolAccess }]
      : [];
  });
  const subject =
    declaring.find((d) => d.connection.id === request.connectionId) ??
    declaring.find((d) => !hasFullAccess(d.connection));
  if (!subject || hasFullAccess(subject.connection)) return null;
  return {
    connectionId: subject.connection.id,
    connectionName: subject.connection.name,
    readTools: subject.toolAccess.readTools,
    fullAccessLabel: subject.toolAccess.fullAccessLabel,
  };
}
