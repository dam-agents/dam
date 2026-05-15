import type { TokenProvider } from "../../auth/index.js";
import type { AuthRequiredError } from "../../instance/domain/errors.js";
import type { Result } from "../../../result.js";

export function createBearerSupplier(
  tokenProvider: TokenProvider,
  host: string,
): () => Promise<Result<string, AuthRequiredError>> {
  return async () => {
    const result = await tokenProvider.getValidAccessToken(host);
    if (result.ok) return result;
    const e = result.error as { kind: string; reason?: string; host?: string };
    if (e.kind === "not-logged-in" || e.kind === "session-expired") {
      const reason = e.kind === "not-logged-in"
        ? (e.host ? `not logged in to ${e.host}` : "not logged in")
        : (e.host ? `session expired for ${e.host}` : "session expired");
      return { ok: false, error: { kind: "auth-required", reason } };
    }
    throw new Error(e.reason ?? e.kind);
  };
}
