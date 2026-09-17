import crypto from "node:crypto";
import { Hono, type Context, type Next } from "hono";
import type { ApiVariables } from "../../../apps/api-server/deps.js";
import type { TtlStore } from "../../../core/ttl-store.js";
import type { SlackInstallService } from "../services/slack-install-service.js";
import { securityLog } from "../../../core/security-log.js";
import { formatError } from "../../../core/format-error.js";

const EXCHANGE_TIMEOUT_MS = 10_000;

export const SLACK_INSTALL_BOT_SCOPES = [
  "commands",
  "chat:write",
  "assistant:write",
  "reactions:write",
  "reactions:read",
  "channels:read",
  "groups:read",
  "im:write",
  "users:read",
  "users:read.email",
  "app_mentions:read",
  "files:read",
  "files:write",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
];

type AppEnv = { Variables: ApiVariables };

export interface SlackInstallPending {
  createdAt: number;
  startedBy: string;
}

export interface SlackInstallOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scopes: string[];
  enterpriseId: string;
}

export interface SlackInstallRoutesDeps {
  pendingInstalls: TtlStore<SlackInstallPending>;
  installs: SlackInstallService;
  oauth: SlackInstallOAuthConfig;
  brandName: string;
  installerRole: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

interface SlackOAuthAccessResponse {
  ok?: boolean;
  error?: string;
  access_token?: string;
  team?: { id?: string; name?: string };
  enterprise?: { id?: string; name?: string } | null;
}

async function exchangeInstallCode(
  oauth: SlackInstallOAuthConfig,
  code: string,
): Promise<SlackOAuthAccessResponse> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      redirect_uri: oauth.callbackUrl,
    }),
  });
  return (await res.json()) as SlackOAuthAccessResponse;
}

async function revokeToken(token: string): Promise<string | null> {
  try {
    const res = await fetch("https://slack.com/api/auth.revoke", {
      method: "POST",
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Bearer ${token}`,
      },
      body: new URLSearchParams({ token }),
    });
    const body = (await res.json()) as { revoked?: boolean; error?: string };
    if (body.revoked === true) return null;
    return body.error ?? `http-${res.status}`;
  } catch (err) {
    return formatError(err);
  }
}

async function exchangeOrError(
  oauth: SlackInstallOAuthConfig,
  code: string,
): Promise<SlackOAuthAccessResponse> {
  try {
    return await exchangeInstallCode(oauth, code);
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export function createSlackInstallRoutes(deps: SlackInstallRoutesDeps) {
  const routes = new Hono<AppEnv>();

  const installerOnly = async (c: Context<AppEnv>, next: Next) => {
    const roles = c.get("roles") ?? [];
    if (!roles.includes(deps.installerRole)) {
      securityLog("warn", "slack.install.denied", {
        category: "privileged",
        actor: c.get("user")?.sub ?? null,
        actorKind: "user",
        surface: "slack",
        decision: "deny",
        reason: "missing-installer-role",
      });
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  };

  routes.get("/install/status", (c) =>
    c.json({ canInstall: (c.get("roles") ?? []).includes(deps.installerRole) }),
  );

  routes.use("/install/start", installerOnly);

  routes.get("/install/start", async (c) => {
    const state = crypto.randomUUID();
    await deps.pendingInstalls.set(state, {
      createdAt: Date.now(),
      startedBy: c.get("user")?.sub ?? "",
    });
    const authorize = new URL("https://slack.com/oauth/v2/authorize");
    authorize.searchParams.set("client_id", deps.oauth.clientId);
    authorize.searchParams.set("scope", deps.oauth.scopes.join(","));
    authorize.searchParams.set("redirect_uri", deps.oauth.callbackUrl);
    authorize.searchParams.set("state", state);
    return c.json({ url: authorize.toString() });
  });

  routes.get("/install/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) return c.text(`Slack refused the install: ${error}`, 400);
    if (!code || !state) return c.text("Missing parameters", 400);

    const pending = await deps.pendingInstalls.consume(state);
    if (!pending) {
      securityLog("warn", "slack.install.denied", {
        category: "channel",
        actor: null,
        actorKind: "external",
        surface: "slack",
        decision: "deny",
        reason: "invalid-state",
      });
      return c.text("Invalid or expired install link. Ask for a new one.", 400);
    }

    const result = await exchangeOrError(deps.oauth, code);
    const teamId = result.team?.id;
    if (!result.ok || !result.access_token || !teamId) {
      securityLog("error", "slack.install.failed", {
        category: "credential",
        actor: pending.startedBy || null,
        actorKind: "user",
        surface: "slack",
        result: "failure",
        reason: result.error ?? "exchange-failed",
      });
      return c.text("Could not complete the install. Try again.", 400);
    }

    const organization = deps.oauth.enterpriseId;
    if (organization && result.enterprise?.id !== organization) {
      const revokeError = await revokeToken(result.access_token);
      securityLog(revokeError ? "error" : "warn", "slack.install.denied", {
        category: "credential",
        actor: pending.startedBy || null,
        actorKind: "user",
        surface: "slack",
        decision: "deny",
        reason: "outside-organization",
        detail: {
          teamId,
          grantWithdrawn: revokeError === null,
          ...(revokeError ? { revokeError } : {}),
        },
      });
      return c.text(
        "That workspace is outside the Slack organization this platform serves.",
        403,
      );
    }

    await deps.installs.record({
      teamId,
      teamName: result.team?.name ?? null,
      botToken: result.access_token,
      installedBy: pending.startedBy || null,
    });

    securityLog("info", "slack.install", {
      category: "credential",
      actor: pending.startedBy || null,
      actorKind: "user",
      surface: "slack",
      result: "success",
      detail: { teamId },
    });

    return c.html(
      `<html><body><h2>${escapeHtml(deps.brandName)} is installed</h2>` +
        `<p>This workspace can now reach agents. You can close this window.</p>` +
        `</body></html>`,
    );
  });

  return routes;
}
