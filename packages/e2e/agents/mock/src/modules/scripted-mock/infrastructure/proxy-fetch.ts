import type { PerformFetchInput, PerformFetchResult } from "mock-agent-api";
import { EnvHttpProxyAgent, fetch } from "undici";
import type { ProxyFetch } from "../services/control-service.js";

const REQUEST_TIMEOUT_MS = 15_000;

// UNIT_BOUNDARY_DESCRIPTION: one fetch through the agent's gateway, on a proxy connection of its own that is closed when the fetch ends. Node's global env-proxy dispatcher keeps one tunnel per origin, and a timeout does not cancel a CONNECT the gateway never answers — a CONNECT sent while the gateway rolls, which a grant does. Every later fetch to that origin then waits behind it, without a new connection, for minutes. Each fetch gets its own dispatcher, so a stuck tunnel costs one fetch.
export function createProxyFetch(): ProxyFetch {
  return async (input: PerformFetchInput): Promise<PerformFetchResult> => {
    const dispatcher = new EnvHttpProxyAgent();
    try {
      const res = await fetch(input.url, {
        dispatcher,
        headers: input.headers ?? {},
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await res.text();
      return { status: res.status, body };
    } finally {
      await dispatcher.destroy();
    }
  };
}
