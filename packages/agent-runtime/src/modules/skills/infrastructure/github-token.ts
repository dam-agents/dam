import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadYamlDocument } from "../../../core/yaml-document.js";

const GH_TOKEN_ENV = "GH_TOKEN";
const GH_HOSTS_FILE = [".config", "gh", "hosts.yml"];
const GITHUB_HOST = "github.com";
export const INERT_GITHUB_TOKEN = "dummy-placeholder";

export function resolveGitHubToken(
  env: Record<string, string | undefined>,
  agentHome: string,
): string {
  return (
    env[GH_TOKEN_ENV] || activeGitHubToken(agentHome) || INERT_GITHUB_TOKEN
  );
}

function activeGitHubToken(agentHome: string): string | undefined {
  const path = join(agentHome, ...GH_HOSTS_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const hosts = loadYamlDocument(readFileSync(path, "utf8"));
    const host = (hosts as Record<string, unknown> | null)?.[GITHUB_HOST];
    const token = (host as Record<string, unknown> | undefined)?.oauth_token;
    return typeof token === "string" && token !== "" ? token : undefined;
  } catch {
    return undefined;
  }
}
