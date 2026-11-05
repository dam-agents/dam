import { agentTokenResponseSchema } from "api-server-api";

export interface AgentTokenExchange {
  mint(
    url: string,
  ): Promise<
    | { ok: true; value: { token: string; expiresAt: Date } }
    | { ok: false; reason: string }
  >;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the call an assistant's CLI makes to turn its own
 * machine identity into a bearer. The route is reachable only from that
 * machine, proves the agent by the way it was reached, and answers with a
 * token that expires in minutes, so nothing is cached across processes.
 */
export function createAgentTokenExchange(deps: {
  fetch?: typeof fetch;
}): AgentTokenExchange {
  const doFetch = deps.fetch ?? fetch;
  return {
    async mint(url) {
      let response: Response;
      try {
        response = await doFetch(url, { method: "POST" });
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
      if (!response.ok) {
        const detail = (await response
          .clone()
          .json()
          .catch(() => ({}))) as { message?: string; error?: string };
        return {
          ok: false,
          reason:
            detail.message ??
            `the install refused the exchange (HTTP ${String(response.status)})`,
        };
      }
      const parsed = agentTokenResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!parsed.success)
        return { ok: false, reason: "the exchange answered no token" };
      return {
        ok: true,
        value: {
          token: parsed.data.token,
          expiresAt: new Date(parsed.data.expiresAt),
        },
      };
    },
  };
}
