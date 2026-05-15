import type { OAuthAppConnection } from "../api/fetchers.js";

/**
 * GitHub App install URL for a connection — `github.com/apps/{slug}/installations/new`
 * for github.com, `{host}/github-apps/{slug}/installations/new` for GitHub
 * Enterprise. Returns null for OAuth-App-shaped connections (no slug
 * persisted on the K8s Secret). Both inputs are server-validated when the
 * Secret is written, so the resulting URL is safe to feed to `window.open`.
 */
export function appInstallUrl(connection: OAuthAppConnection): string | null {
  if (!connection.appSlug) return null;
  if (connection.appId === "github-enterprise") {
    return `https://${connection.hostPattern}/github-apps/${connection.appSlug}/installations/new`;
  }
  return `https://github.com/apps/${connection.appSlug}/installations/new`;
}
