export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc?: string;
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc?: string;
  method: string;
  params?: unknown;
}

export type JsonRpcFrame =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcNotification;

export function parseFrame(line: string): JsonRpcFrame | null {
  try {
    const f = JSON.parse(line) as unknown;
    return f && typeof f === "object" ? (f as JsonRpcFrame) : null;
  } catch {
    return null;
  }
}

export function isRequest(frame: JsonRpcFrame): frame is JsonRpcRequest {
  const f = frame as Partial<JsonRpcRequest>;
  return f.id !== undefined && typeof f.method === "string";
}
