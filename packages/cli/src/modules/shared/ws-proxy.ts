import type { Agent } from "node:http";
import type { ClientOptions } from "ws";

import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

export function proxyAgentForUrl(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): Agent | undefined {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return undefined;
  }

  const secure = target.protocol === "wss:" || target.protocol === "https:";
  const proxy = secure
    ? (env.HTTPS_PROXY ?? env.https_proxy)
    : (env.HTTP_PROXY ?? env.http_proxy);
  if (!proxy) return undefined;
  if (isNoProxy(target.hostname, env.NO_PROXY ?? env.no_proxy))
    return undefined;

  return secure ? new HttpsProxyAgent(proxy) : new HttpProxyAgent(proxy);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: how the CLI opens a WebSocket to the install: through
 * the proxy its environment names, with the URL's `token` also sent as
 * `Authorization: Bearer`. Inside an Agent that token is a placeholder, and the
 * Agent's gateway puts the real key in that header and never in the query, so
 * the header is what lets `dam run`, `dam chat` and `dam ssh` work from there.
 */
export function wsClientOptions(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): ClientOptions {
  const agent = proxyAgentForUrl(url, env);
  let token: string | null = null;
  try {
    token = new URL(url).searchParams.get("token");
  } catch {
    token = null;
  }
  return {
    ...(agent && { agent }),
    ...(token && { headers: { Authorization: `Bearer ${token}` } }),
  };
}

function isNoProxy(host: string, noProxy: string | undefined): boolean {
  if (!noProxy) return false;
  for (const raw of noProxy.split(",")) {
    const entry = raw.trim();
    if (entry === "") continue;
    if (entry === "*") return true;
    const bare = (entry.startsWith(".") ? entry.slice(1) : entry).toLowerCase();
    if (host === bare || host.endsWith(`.${bare}`)) return true;
  }
  return false;
}
