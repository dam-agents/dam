import type { ModelDialect } from "../../model-catalog/index.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a token count is answered for free and without
 * a usage block, so it gets no spend record and never shows as an uncounted
 * call.
 */
export type RouteKind =
  | { kind: "model"; dialect: ModelDialect; path: string; billed: boolean }
  | { kind: "other"; path: string };

const BOB_INFERENCE_PREFIX = "/inference";

/**
 * UNIT_BOUNDARY_DESCRIPTION: pi-ai appends `/v1/messages` to a base that
 * already ends in `/v1`, and Bob calls under its compiled-in `/inference`
 * prefix, so both are folded away before the path is classified.
 */
export function normalizePath(rawPath: string): string {
  let path = rawPath.replace(/\/{2,}/g, "/");
  if (path.startsWith(`${BOB_INFERENCE_PREFIX}/`))
    path = path.slice(BOB_INFERENCE_PREFIX.length);
  path = path.replace(/^\/v1\/v1\//, "/v1/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Bob cannot stamp the harness header and alone
 * calls under its compiled-in `/inference` prefix, so the prefix names the
 * harness when no header does.
 */
export function bobGatewayPath(rawPath: string): boolean {
  return rawPath.replace(/\/{2,}/g, "/").startsWith(`${BOB_INFERENCE_PREFIX}/`);
}

export function classify(method: string, rawPath: string): RouteKind {
  const path = normalizePath(rawPath);
  if (method === "POST") {
    if (path === "/v1/messages")
      return {
        kind: "model",
        dialect: "anthropic-messages",
        path,
        billed: true,
      };
    if (path === "/v1/messages/count_tokens")
      return {
        kind: "model",
        dialect: "anthropic-messages",
        path,
        billed: false,
      };
    if (path === "/v1/chat/completions")
      return { kind: "model", dialect: "openai-chat", path, billed: true };
    if (path === "/v1/responses")
      return { kind: "model", dialect: "openai-responses", path, billed: true };
  }
  return { kind: "other", path };
}
