import type { ApiClient } from "./api-client.js";

export interface CustomHeaderConnectionInput {
  name: string;
  host: string;
  headerName: string;
  valueFormat: string;
  value: string;
  envName: string;
}

export async function getConnectionId(
  api: ApiClient,
  connectionName: string,
): Promise<string> {
  const connections = await api.connections.list.query();
  const conn = connections.find((c) => c.name === connectionName);
  if (!conn) throw new Error(`connection ${connectionName} not found`);
  return conn.id;
}

export async function ensureCustomHeaderConnection(
  api: ApiClient,
  input: CustomHeaderConnectionInput,
): Promise<string> {
  const existing = (await api.connections.list.query()).find(
    (c) => c.name === input.name,
  );
  if (existing) return existing.id;

  const { id } = await api.connections.create.mutate({
    templateId: "custom-header",
    authKind: "header",
    name: input.name,
    host: input.host,
    headerName: input.headerName,
    valueFormat: input.valueFormat,
    value: input.value,
    envName: input.envName,
  });
  return id;
}
