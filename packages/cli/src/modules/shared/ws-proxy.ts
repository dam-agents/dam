import type { Agent } from "node:http";

import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

/**
 * The `ws` client opens its own raw http/https socket and, unlike Node's global
 * fetch/undici (which honors `NODE_USE_ENV_PROXY`), it ignores the standard
 * proxy env vars. In locked-down environments — e.g. an agent pod whose only
 * egress path is a forward proxy that also injects auth — a WebSocket opened
 * without an explicit agent bypasses the proxy, so the connection is refused
 * and the caller sees the stream close mid-handshake. The tRPC/REST calls work
 * in the same environment precisely because they go through fetch.
 *
 * Build a proxy agent from the environment so `ws` tunnels through it too.
 * Returns undefined when no proxy applies (no relevant `*_PROXY` var, or the
 * target host matches `NO_PROXY`), which leaves direct-connection behavior
 * unchanged — `ws` treats `{ agent: undefined }` as "no agent".
 */
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

  // A `wss:`/`https:` target is tunneled through the proxy with CONNECT
  // (HttpsProxyAgent); a plain `ws:`/`http:` target is forwarded with an
  // absolute-form request (HttpProxyAgent). The proxy URL's own scheme is
  // orthogonal — both agents accept an `http://` proxy.
  return secure ? new HttpsProxyAgent(proxy) : new HttpProxyAgent(proxy);
}

/**
 * Match a hostname against a `NO_PROXY` list: comma-separated hosts or domain
 * suffixes, an optional leading dot, and `*` as a wildcard for all hosts.
 */
function isNoProxy(host: string, noProxy: string | undefined): boolean {
  if (!noProxy) return false;
  for (const raw of noProxy.split(",")) {
    const entry = raw.trim();
    if (entry === "") continue;
    if (entry === "*") return true;
    // Compare case-insensitively like curl/undici; URL already lowercases
    // the target hostname, so only the entry needs normalizing.
    const bare = (entry.startsWith(".") ? entry.slice(1) : entry).toLowerCase();
    if (host === bare || host.endsWith(`.${bare}`)) return true;
  }
  return false;
}
