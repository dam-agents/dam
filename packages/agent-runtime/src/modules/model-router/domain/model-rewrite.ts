import { Transform } from "node:stream";
import type { ModelDialect } from "../../model-catalog/index.js";

type Json = Record<string, unknown>;

function rewriteEvent(dialect: ModelDialect, obj: Json, name: string): boolean {
  switch (dialect) {
    case "anthropic-messages": {
      const message = obj.message as Json | undefined;
      if (obj.type === "message_start" && message && "model" in message) {
        message.model = name;
        return true;
      }
      if (typeof obj.model === "string") {
        obj.model = name;
        return true;
      }
      return false;
    }
    case "openai-chat":
      if (typeof obj.model === "string") {
        obj.model = name;
        return true;
      }
      return false;
    case "openai-responses": {
      const response = obj.response as Json | undefined;
      if (response && typeof response.model === "string") {
        response.model = name;
        return true;
      }
      if (typeof obj.model === "string") {
        obj.model = name;
        return true;
      }
      return false;
    }
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: puts the name the harness asked for back into
 * the response's model field, since claude-agent-acp restores a loaded
 * session from its transcript's last assistant model, which must stay a name
 * the router resolves. Streams are rewritten line by line; every other byte
 * passes through unchanged.
 */
export function rewriteBody(
  dialect: ModelDialect,
  body: string,
  name: string,
): string {
  try {
    const obj = JSON.parse(body) as Json;
    if (!obj || typeof obj !== "object") return body;
    return rewriteEvent(dialect, obj, name) ? JSON.stringify(obj) : body;
  } catch {
    return body;
  }
}

export function createSseModelRewrite(
  dialect: ModelDialect,
  name: string,
): Transform {
  let tail = "";
  const rewriteLine = (line: string): string => {
    if (!line.startsWith("data:")) return line;
    const payload = line.slice(5).trimStart();
    if (!payload.startsWith("{")) return line;
    const rewritten = rewriteBody(dialect, payload, name);
    return rewritten === payload ? line : `data: ${rewritten}`;
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      const text = tail + chunk.toString("utf8");
      const lines = text.split("\n");
      tail = lines.pop() ?? "";
      cb(null, lines.map((l) => `${rewriteLine(l)}\n`).join(""));
    },
    flush(cb) {
      cb(null, tail ? rewriteLine(tail) : "");
    },
  });
}
