import { formatError } from "../../../core/format-error.js";

export interface SlackRequestInit {
  headers?: Record<string, string>;
  body?: string | FormData;
  method?: string;
  redirect?: "error" | "follow" | "manual";
  signal?: AbortSignal;
}

export type SlackFetch = (
  url: string | URL,
  init?: SlackRequestInit,
) => Promise<Response>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Socket Mode client's requests, signed with
 * the app-level token that is current at the time of each request.
 *
 * The Socket Mode client takes its app-level token once, when it is built,
 * and sends it on every `apps.connections.open`. A rotating token expires
 * after twelve hours, so every reconnect must ask for the token again. This
 * fetch replaces the client's `Authorization` header with the token the
 * resolver gives now. When the resolver fails, as on a short outage of the
 * Kubernetes API, the token it gave last is used again: it was valid then and
 * Slack is the judge of whether it still is. When there is no token at all,
 * Slack is not called and the answer is Slack's own `not_authed` refusal: the Socket
 * Mode client stops at once on that refusal instead of retrying the request a
 * hundred times, and the gateway's own reconnect tries again later.
 */
export function fetchWithCurrentAppToken(
  resolveAppToken: () => Promise<string | null>,
  fetchImpl?: SlackFetch,
): SlackFetch {
  let lastToken: string | null = null;
  return async (url, init) => {
    let token: string | null;
    try {
      token = await resolveAppToken();
      lastToken = token;
    } catch (err) {
      process.stderr.write(
        `[slack] Could not read the app-level token, using the last one: ${formatError(err)}\n`,
      );
      token = lastToken;
    }
    if (token === null) {
      return new Response(JSON.stringify({ ok: false, error: "not_authed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return (fetchImpl ?? globalThis.fetch)(url, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
  };
}
