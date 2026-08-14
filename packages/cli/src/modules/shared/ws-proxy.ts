import type { Agent } from "node:http";

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
