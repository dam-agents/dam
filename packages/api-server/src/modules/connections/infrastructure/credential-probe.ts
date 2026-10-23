import { z } from "zod";
import { isGitHubEnterpriseServer } from "api-server-api";
import type {
  CredentialProbe,
  CredentialProbeOutcome,
} from "../domain/credential-check.js";
import { stripControlChars } from "./github-identity.js";
import { probeKubernetesToken } from "./kubernetes-token-probe.js";

const DEFAULT_TIMEOUT_MS = 10_000;

const githubUserSchema = z.object({ login: z.string() });
const githubErrorSchema = z.object({ message: z.string() });

function githubUserUrl(host: string): string {
  if (host === "github.com") return "https://api.github.com/user";
  return isGitHubEnterpriseServer(host)
    ? `https://${host}/api/v3/user`
    : `https://api.${host}/user`;
}

function githubExpiry(header: string | null): string | undefined {
  if (!header) return undefined;
  const at = new Date(header);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

function githubScopes(header: string | null): string[] | undefined {
  if (header === null) return undefined;
  return header
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function githubMessage(res: Response): Promise<string> {
  const parsed = githubErrorSchema.safeParse(
    await res.json().catch(() => null),
  );
  return parsed.success ? stripControlChars(parsed.data.message) : "";
}

async function probeGitHubToken(
  host: string,
  value: string,
  timeoutMs: number,
): Promise<CredentialProbeOutcome> {
  let res: Response;
  try {
    res = await fetch(githubUserUrl(host), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${value}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "platform",
      },
    });
  } catch (err) {
    return {
      status: "unchecked",
      reason:
        err instanceof Error && err.name === "TimeoutError"
          ? "GitHub did not answer in time"
          : "GitHub could not be reached",
    };
  }
  if (res.ok) {
    const user = githubUserSchema.safeParse(
      await res.json().catch(() => null),
    );
    const expiresAt = githubExpiry(
      res.headers.get("github-authentication-token-expiration"),
    );
    const scopes = githubScopes(res.headers.get("x-oauth-scopes"));
    return {
      status: "passed",
      ...(user.success
        ? { account: stripControlChars(user.data.login) }
        : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(scopes ? { scopes } : {}),
    };
  }
  if (res.status === 401) {
    const message = await githubMessage(res);
    return {
      status: "failed",
      reason: `GitHub refused the token (${message || "HTTP 401"})`,
    };
  }
  if (res.status === 403 && res.headers.get("x-github-sso")) {
    await res.body?.cancel();
    return {
      status: "failed",
      reason:
        "an organization requires SSO authorization for this token; authorize it on GitHub",
    };
  }
  await res.body?.cancel();
  return {
    status: "unchecked",
    reason: `GitHub answered HTTP ${res.status}, which says nothing about the token`,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: Checks a token with the check its Connection Template names, before it is saved and when the owner asks again. A GitHub token is sent to the user endpoint of its host — api.github.com, `/api/v3` on a GitHub Enterprise Server, `api.` on a GHE.com tenancy: a 200 passes and names the login, the token's expiry and, for a classic token, its scopes; a 401 fails with GitHub's own message, and a 403 that asks for SSO authorization fails with that; any other answer, a timeout or a network error says nothing about the token and leaves it unchecked, with a fixed reason: an error's own text can carry the request, and the reason is stored and shown. A Kubernetes service-account token is checked on its cluster's API server by the Kubernetes token probe.
export function createCredentialProbe(
  opts: { timeoutMs?: number } = {},
): CredentialProbe {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    probe(kind, target, value) {
      return kind === "kubernetes-token"
        ? probeKubernetesToken(target, value, timeoutMs)
        : probeGitHubToken(target.host, value, timeoutMs);
    },
  };
}
