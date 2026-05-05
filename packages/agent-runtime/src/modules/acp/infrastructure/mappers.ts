const AUTH_HINT =
  "Authentication Error: Ensure the API/OAuth credential secret is correct and linked to this agent (Agents > select agent > Secrets).\n\nError: ";

/**
 * Prepend the authentication hint to any frame whose error or text content
 * mentions `authentication_error`. Parses and re-serializes only when a rewrite
 * is needed; otherwise returns the input untouched.
 */
export function rewriteAuthError(line: string): string {
  try {
    const msg = JSON.parse(line);
    if (msg?.error?.message?.includes?.("authentication_error")) {
      msg.error.message = AUTH_HINT + msg.error.message;
      return JSON.stringify(msg);
    }
    const text = msg?.params?.update?.content?.text;
    if (typeof text === "string" && text.includes("authentication_error")) {
      msg.params.update.content.text = AUTH_HINT + text;
      return JSON.stringify(msg);
    }
  } catch {
    // Non-JSON frames pass through unchanged.
  }
  return line;
}

/**
 * Clients declare their own cwd (often ".") but the agent process runs with a
 * fixed working directory defined by the pod. Rewrite the param so the agent
 * always sees the real path.
 */
export function rewriteCwd<T>(frame: T, workingDir: string): T {
  if (typeof frame !== "object" || frame === null) return frame;
  const params = (frame as { params?: unknown }).params;
  if (typeof params !== "object" || params === null) return frame;
  const p = params as Record<string, unknown>;
  if (p.cwd === undefined) return frame;
  return { ...(frame as object), params: { ...p, cwd: workingDir } } as T;
}
