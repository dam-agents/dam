import { createHash } from "node:crypto";

export type JsonRpcId = string | number | null;

export interface McpMessage {
  readonly id?: JsonRpcId;
  readonly request: boolean;
  readonly toolCall?: {
    readonly name: string | null;
    readonly arguments: unknown;
  };
}

// UNIT_BOUNDARY_DESCRIPTION: what the body of a request to an MCP server says about tool calls. `messages` holds one entry per JSON-RPC message, `batch` says the body was an array of them, and an entry has `toolCall` when its method is `tools/call`; the name is null when the call names no tool as a string, and `arguments` is the call's `params.arguments` as sent, undefined when it has none. `request` says the message has a method, so it is a request or a notification and not the client's answer to the server. Keys are read in any letter case, and two keys of one object that differ only in case count as repeated, since a server may match keys either way. `unreadable` is a body that is not one strict JSON document with unique keys whose messages are all objects: a server could read such a body another way, and find a tool call this reader missed.
export type McpRequestBody =
  | { readonly kind: "unreadable" }
  | {
      readonly kind: "messages";
      readonly batch: boolean;
      readonly messages: readonly McpMessage[];
    };

const TOOL_CALL_METHOD = "tools/call";

function stringEnd(text: string, start: number): number {
  let i = start + 1;
  while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
  return i + 1;
}

function nextToken(text: string, from: number): string | undefined {
  let i = from;
  while (
    text[i] === " " ||
    text[i] === "\t" ||
    text[i] === "\n" ||
    text[i] === "\r"
  )
    i++;
  return text[i];
}

function hasRepeatedKey(validJson: string): boolean {
  const open: (Set<string> | null)[] = [];
  let i = 0;
  while (i < validJson.length) {
    const c = validJson[i];
    if (c === "{") open.push(new Set());
    else if (c === "[") open.push(null);
    else if (c === "}" || c === "]") open.pop();
    else if (c === '"') {
      const end = stringEnd(validJson, i);
      const keys = open[open.length - 1];
      if (keys && nextToken(validJson, end) === ":") {
        const key = (
          JSON.parse(validJson.slice(i, end)) as string
        ).toLowerCase();
        if (keys.has(key)) return true;
        keys.add(key);
      }
      i = end;
      continue;
    }
    i++;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: Record<string, unknown>, name: string): unknown {
  for (const key of Object.keys(value))
    if (key.toLowerCase() === name) return value[key];
  return undefined;
}

function idOf(value: Record<string, unknown>): { id?: JsonRpcId } {
  const id = field(value, "id");
  return typeof id === "string" || typeof id === "number" || id === null
    ? { id }
    : {};
}

function messageOf(value: Record<string, unknown>): McpMessage {
  const method = field(value, "method");
  const request = typeof method === "string";
  if (!request || method.trim().toLowerCase() !== TOOL_CALL_METHOD)
    return { ...idOf(value), request };
  const params = field(value, "params");
  const name = isRecord(params) ? field(params, "name") : undefined;
  return {
    ...idOf(value),
    request,
    toolCall: {
      name: typeof name === "string" ? name : null,
      arguments: isRecord(params) ? field(params, "arguments") : undefined,
    },
  };
}

export function readMcpRequestBody(text: string): McpRequestBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "unreadable" };
  }
  const values = Array.isArray(parsed) ? parsed : [parsed];
  if (!values.every(isRecord)) return { kind: "unreadable" };
  if (hasRepeatedKey(text)) return { kind: "unreadable" };
  return {
    kind: "messages",
    batch: Array.isArray(parsed),
    messages: values.map(messageOf),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

// UNIT_BOUNDARY_DESCRIPTION: the join key of a held tool call: the sha256 of the Connection id, the tool name and the arguments as canonical JSON, with keys sorted and no whitespace. The JSON-RPC id and the order of keys do not change it, so the same call sent again finds the approval it waits on.
export function toolCallKey(
  connectionId: string,
  tool: string,
  args: unknown,
): string {
  return createHash("sha256")
    .update(JSON.stringify([connectionId, tool, canonicalJson(args)]))
    .digest("hex");
}

// UNIT_BOUNDARY_DESCRIPTION: the arguments a tool-call approval keeps while it waits, so the person who answers sees what the call does. JSON of at most the limit is kept as it is; larger JSON keeps only its first part, cut on a character boundary, as a string. `argumentsBytes` is always the size of the whole JSON.
export function shownToolCallArguments(
  args: unknown,
  maxBytes: number,
): { arguments?: unknown; argumentsBytes: number } {
  if (args === undefined) return { argumentsBytes: 0 };
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  if (bytes.length <= maxBytes)
    return { arguments: args, argumentsBytes: bytes.length };
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return {
    arguments: new TextDecoder().decode(bytes.subarray(0, end)),
    argumentsBytes: bytes.length,
  };
}
