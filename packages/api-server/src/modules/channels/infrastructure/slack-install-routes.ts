import crypto from "node:crypto";
import { Hono } from "hono";
import type { TtlStore } from "../../../core/ttl-store.js";
import type { SlackInstallService } from "../services/slack-install-service.js";
import { securityLog } from "../../../core/security-log.js";

export const SLACK_INSTALL_BOT_SCOPES = [
  "commands",
  "chat:write",
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
  "mpim:read",
];

export interface SlackInstallPending {
  createdAt: number;
}

export interface SlackInstallOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scopes: string[];
}

export interface SlackInstallRoutesDeps {
  pendingInstalls: TtlStore<SlackInstallPending>;
  installs: SlackInstallService;
  oauth: SlackInstallOAuthConfig;
  brandName: string;
}

interface SlackOAuthAccessResponse {
  ok?: boolean;
  error?: string;
  access_token?: string;
  team?: { id?: string; name?: string };
}

async function exchangeInstallCode(
  oauth: SlackInstallOAuthConfig,
  code: string,
): Promise<SlackOAuthAccessResponse> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
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

export function createSlackInstallRoutes(deps: SlackInstallRoutesDeps) {
  const routes = new Hono();

  routes.get("/install/start", async (c) => {
    const state = crypto.randomUUID();
    await deps.pendingInstalls.set(state, { createdAt: Date.now() });
    const authorize = new URL("https://slack.com/oauth/v2/authorize");
    authorize.searchParams.set("client_id", deps.oauth.clientId);
    authorize.searchParams.set("scope", deps.oauth.scopes.join(","));
    authorize.searchParams.set("redirect_uri", deps.oauth.callbackUrl);
    authorize.searchParams.set("state", state);
    return c.redirect(authorize.toString());
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

    const result = await exchangeInstallCode(deps.oauth, code);
    const teamId = result.team?.id;
    if (!result.ok || !result.access_token || !teamId) {
      process.stderr.write(
        `[slack-install] exchange failed: ${result.error ?? "unknown"}\n`,
      );
      return c.text("Could not complete the install. Try again.", 400);
    }

    await deps.installs.record({
      teamId,
      teamName: result.team?.name ?? null,
      botToken: result.access_token,
      installedBy: null,
    });

    securityLog("info", "slack.install", {
      category: "channel",
      actor: null,
      actorKind: "external",
      surface: "slack",
      result: "success",
      detail: { teamId, teamName: result.team?.name },
    });

    return c.html(
      `<html><body><h2>${deps.brandName} is installed</h2>` +
        `<p>This workspace can now reach agents. You can close this window.</p>` +
        `</body></html>`,
    );
  });

  return routes;
}
