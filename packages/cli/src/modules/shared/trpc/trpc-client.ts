import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import type { AppRouter } from "api-server-api";
import type { AppRouter as AgentRuntimeAppRouter } from "agent-runtime-api";
import type { TokenProvider } from "../../auth/index.js";

export type TrpcClient = TRPCClient<AppRouter>;
export type AgentTrpcClient = TRPCClient<AgentRuntimeAppRouter>;

export class AuthRequiredAtTransportError extends Error {
  readonly kind = "auth-required" as const;
  constructor(reason: string) {
    super(reason);
    this.name = "AuthRequiredAtTransportError";
  }
}

export class TermsStaleAtTransportError extends Error {
  readonly kind = "terms-stale" as const;
  constructor(public readonly host: string) {
    super(`Terms of Use acceptance required at ${host}`);
    this.name = "TermsStaleAtTransportError";
  }
}

function buildAuthHeaders(deps: {
  host: string;
  tokenProvider: TokenProvider;
}): () => Promise<Record<string, string>> {
  return async () => {
    const result = await deps.tokenProvider.getValidAccessToken(deps.host);
    if (result.ok) return { authorization: `Bearer ${result.value}` };
    const e = result.error as {
      kind: string;
      reason?: string;
      host?: string;
    };
    if (e.kind === "not-logged-in" || e.kind === "session-expired") {
      const reason =
        e.kind === "not-logged-in"
          ? e.host
            ? `not logged in to ${e.host}`
            : "not logged in"
          : e.host
            ? `session expired for ${e.host}`
            : "session expired";
      throw new AuthRequiredAtTransportError(reason);
    }
    throw new Error(e.reason ?? e.kind);
  };
}

function wrapFetchWithTermsGate(
  host: string,
  baseFetch?: typeof fetch,
): typeof fetch {
  const inner = baseFetch ?? fetch;
  return (async (input, init) => {
    const response = await inner(input, init);
    if (response.status === 412) {
      const clone = response.clone();
      try {
        const body = (await clone.json()) as { error?: string };
        if (body.error === "terms_stale") {
          throw new TermsStaleAtTransportError(host);
        }
      } catch (err) {
        if (err instanceof TermsStaleAtTransportError) throw err;
      }
    }
    return response;
  }) as typeof fetch;
}

export function createTrpcClient(deps: {
  host: string;
  tokenProvider: TokenProvider;
  fetch?: typeof fetch;
}): TrpcClient {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${deps.host.replace(/\/+$/, "")}/api/trpc`,
        fetch: wrapFetchWithTermsGate(deps.host, deps.fetch),
        headers: buildAuthHeaders(deps),
      }),
    ],
  });
}

export function createAgentTrpcClient(deps: {
  host: string;
  agentId: string;
  tokenProvider: TokenProvider;
  fetch?: typeof fetch;
}): AgentTrpcClient {
  const base = `${deps.host.replace(/\/+$/, "")}/api/agents/${encodeURIComponent(deps.agentId)}/trpc`;
  return createTRPCClient<AgentRuntimeAppRouter>({
    links: [
      httpBatchLink({
        url: base,
        fetch: wrapFetchWithTermsGate(deps.host, deps.fetch),
        headers: buildAuthHeaders(deps),
      }),
    ],
  });
}
