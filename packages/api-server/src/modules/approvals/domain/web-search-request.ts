const WEB_SEARCH_TOOL_TYPE = /^web_search_\d+$/;
const MAX_DEPTH = 512;
const MAX_QUERY_LENGTH = 1000;
const CLAUDE_CODE_SEARCH_PROMPT =
  /^Perform a web search for the query: ([\s\S]+)$/;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const CONTROL_CHARACTER = /[\u0000-\u001f]/;

// UNIT_BOUNDARY_DESCRIPTION: what a model call's body says about web search. `search` is a call that declares a native web search tool (`web_search_` and a date, the Messages API's server tool), with the query when the call has Claude Code's shape and null when the model chooses it; `stream` and `model` shape the failed search a refusal answers with. `unreadable` is a body that is not one strict JSON document with unique keys, which a provider could still read another way.
export type WebSearchRequest =
  | { readonly kind: "none" }
  | { readonly kind: "unreadable" }
  | {
      readonly kind: "search";
      readonly query: string | null;
      readonly stream: boolean;
      readonly model: string;
    };

type Role = "plain" | "tools" | "tool" | "toolType";

class Unreadable extends Error {}

// UNIT_BOUNDARY_DESCRIPTION: a strict reader of one JSON document that answers whether any `tools` list in it, at any depth, holds a native web search tool. It accepts only what RFC 8259 allows, with no duplicate key in any object: a lenient parser upstream that takes NaN, a trailing comma, the first of two keys or the last one would otherwise read a tool this reader missed. It builds no value it does not need, so a long conversation costs one pass.
class ToolScanner {
  private i = 0;
  declaresWebSearch = false;

  constructor(private readonly s: string) {}

  scan(): boolean {
    this.skipSpace();
    this.value("plain", 0);
    this.skipSpace();
    if (this.i !== this.s.length) throw new Unreadable();
    return this.declaresWebSearch;
  }

  private skipSpace(): void {
    const s = this.s;
    while (this.i < s.length) {
      const c = s.charCodeAt(this.i);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return;
      this.i++;
    }
  }

  private value(role: Role, depth: number): void {
    if (depth > MAX_DEPTH) throw new Unreadable();
    const c = this.s[this.i];
    if (c === "{") return this.object(role === "tool", depth + 1);
    if (c === "[") return this.array(role === "tools", depth + 1);
    if (c === '"') {
      const text = this.string(role === "toolType");
      if (text !== null && WEB_SEARCH_TOOL_TYPE.test(text))
        this.declaresWebSearch = true;
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (this.s.startsWith(literal, this.i)) {
        this.i += literal.length;
        return;
      }
    }
    NUMBER.lastIndex = this.i;
    const number = NUMBER.exec(this.s);
    if (!number || number[0].length === 0) throw new Unreadable();
    this.i += number[0].length;
  }

  private object(isTool: boolean, depth: number): void {
    this.i++;
    this.skipSpace();
    if (this.s[this.i] === "}") {
      this.i++;
      return;
    }
    const keys = new Set<string>();
    for (;;) {
      if (this.s[this.i] !== '"') throw new Unreadable();
      const key = this.string(true)!;
      if (keys.has(key)) throw new Unreadable();
      keys.add(key);
      this.skipSpace();
      if (this.s[this.i] !== ":") throw new Unreadable();
      this.i++;
      this.skipSpace();
      this.value(
        key === "tools"
          ? "tools"
          : isTool && key === "type"
            ? "toolType"
            : "plain",
        depth,
      );
      this.skipSpace();
      const next = this.s[this.i++];
      if (next === "}") return;
      if (next !== ",") throw new Unreadable();
      this.skipSpace();
    }
  }

  private array(isTools: boolean, depth: number): void {
    this.i++;
    this.skipSpace();
    if (this.s[this.i] === "]") {
      this.i++;
      return;
    }
    for (;;) {
      this.value(isTools ? "tool" : "plain", depth);
      this.skipSpace();
      const next = this.s[this.i++];
      if (next === "]") return;
      if (next !== ",") throw new Unreadable();
      this.skipSpace();
    }
  }

  private string(wanted: boolean): string | null {
    const s = this.s;
    const start = this.i + 1;
    const close = s.indexOf('"', start);
    if (close === -1) throw new Unreadable();
    const plain = s.slice(start, close);
    if (!plain.includes("\\")) {
      if (CONTROL_CHARACTER.test(plain)) throw new Unreadable();
      this.i = close + 1;
      return wanted ? plain : null;
    }
    let out = "";
    let i = start;
    for (;;) {
      if (i >= s.length) throw new Unreadable();
      const c = s.charCodeAt(i);
      if (c === 0x22) break;
      if (c < 0x20) throw new Unreadable();
      if (c !== 0x5c) {
        if (wanted) out += s[i];
        i++;
        continue;
      }
      const escape = s[i + 1];
      if (escape === "u") {
        const hex = s.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Unreadable();
        if (wanted) out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      const simple = ESCAPES[escape ?? ""];
      if (simple === undefined) throw new Unreadable();
      if (wanted) out += simple;
      i += 2;
    }
    this.i = i + 1;
    return wanted ? out : null;
  }
}

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.length !== 1) return null;
  const [block] = content as unknown[];
  if (typeof block !== "object" || block === null) return null;
  const { type, text } = block as { type?: unknown; text?: unknown };
  return type === "text" && typeof text === "string" ? text : null;
}

function claudeCodeQuery(request: Record<string, unknown>): string | null {
  const { messages, tools } = request;
  if (!Array.isArray(tools) || !Array.isArray(messages)) return null;
  const onlySearch = tools.every(
    (tool: unknown) =>
      typeof tool === "object" &&
      tool !== null &&
      typeof (tool as { type?: unknown }).type === "string" &&
      WEB_SEARCH_TOOL_TYPE.test((tool as { type: string }).type),
  );
  if (!onlySearch || messages.length !== 1) return null;
  const [message] = messages as unknown[];
  if (typeof message !== "object" || message === null) return null;
  const { role, content } = message as { role?: unknown; content?: unknown };
  if (role !== "user") return null;
  const query = CLAUDE_CODE_SEARCH_PROMPT.exec(textOf(content) ?? "")?.[1];
  const trimmed = query?.trim();
  return trimmed ? trimmed.slice(0, MAX_QUERY_LENGTH) : null;
}

export function readWebSearchRequest(text: string): WebSearchRequest {
  if (text.trim() === "") return { kind: "none" };
  let declares: boolean;
  try {
    declares = new ToolScanner(text).scan();
  } catch (err) {
    if (err instanceof Unreadable || err instanceof RangeError)
      return { kind: "unreadable" };
    throw err;
  }
  if (!declares) return { kind: "none" };
  const parsed: unknown = JSON.parse(text);
  const request =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return {
    kind: "search",
    query: claudeCodeQuery(request),
    stream: request.stream === true,
    model: typeof request.model === "string" ? request.model : "unknown",
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the form of a model call's path that a provider routes on: the query and the Connection address dropped, escapes decoded, letters lowered and repeated or trailing slashes folded, so a path spelled to look like something else still names the endpoint the provider serves. A path that does not decode stays as sent, and is then read as a Messages path, which refuses rather than passes.
function routedPath(path: string): string {
  const bare = path.split("?")[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return "/messages";
  }
  return decoded.toLowerCase().replace(/\/+/g, "/").replace(/\/+$/, "");
}

// UNIT_BOUNDARY_DESCRIPTION: which endpoint of the Messages API a path reaches. `messages` creates a message, and is the one a failed search can answer in its own shape; `other` is any other Messages endpoint (batches, which run their requests later); `count` counts tokens and runs no tool; `none` is not the Messages API.
export type MessagesEndpoint = "messages" | "other" | "count" | "none";

export function messagesEndpointOf(path: string): MessagesEndpoint {
  const routed = routedPath(path);
  if (routed.endsWith("/messages/count_tokens")) return "count";
  if (routed.endsWith("/messages")) return "messages";
  if (routed.includes("/messages/")) return "other";
  return "none";
}
