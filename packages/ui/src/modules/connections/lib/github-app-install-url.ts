import type { ConnectionView } from "api-server-api";

type GithubAppInstallInput = Pick<
  ConnectionView,
  "templateId" | "host" | "appSlug"
>;

export function githubAppInstallUrl(
  connection: GithubAppInstallInput,
): string | null {
  if (!connection.appSlug) return null;
  const isEnterprise = connection.templateId === "github-enterprise";
  const host = isEnterprise ? connection.host : "github.com";
  if (!host) return null;
  const segment = isEnterprise ? "github-apps" : "apps";
  return `https://${host}/${segment}/${connection.appSlug}/installations/new`;
}
