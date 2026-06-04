import type { PerformFetchInput, PerformFetchResult } from "mock-agent-api";
import type { ProxyFetch } from "../services/control-service.js";

const REQUEST_TIMEOUT_MS = 15_000;

export function createProxyFetch(): ProxyFetch {
  return async (input: PerformFetchInput): Promise<PerformFetchResult> => {
    const res = await fetch(input.url, {
      headers: input.headers ?? {},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.text();
    return { status: res.status, body };
  };
}
