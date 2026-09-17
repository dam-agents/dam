import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { SLACK_INSTALL_BOT_SCOPES } from "../../modules/channels/infrastructure/slack-install-routes.js";

/**
 * TEST_OVERVIEW: The scopes asked for when a workspace is connected over OAuth
 * must be the scopes the Slack app actually declares. They live in two places —
 * the app manifest an operator builds the app from, and the authorize URL the
 * platform builds — and a copy that drifts is silent: Slack grants what was
 * asked for, and the capability behind a forgotten scope simply never works in
 * that workspace. Worse, a scope added to the manifest later never reaches an
 * app already installed, so the gap outlives the fix.
 */

const MANIFEST = fileURLToPath(
  new URL("../../../../../etc/slack/app-manifest.yaml", import.meta.url),
);

function manifestBotScopes(): string[] {
  const yaml = readFileSync(MANIFEST, "utf8");
  const oauth = yaml.split("oauth_config:")[1]?.split("\nsettings:")[0] ?? "";
  const scopes = [
    ...oauth.matchAll(/^\s*-\s+([a-z_]+:[a-z._]+|commands)\s*$/gm),
  ]
    .map((m) => m[1]!)
    .filter((s) => !s.startsWith("https"));
  return [...new Set(scopes)];
}

describe("slack install scopes", () => {
  /**
   * TEST_SCENARIO: The manifest is the source an operator builds the app from,
   * so it is the one that decides. Asking for a scope it does not declare, or
   * forgetting one it does, is the drift this guards.
   */
  it("asks for exactly the bot scopes the app manifest declares", () => {
    expect([...SLACK_INSTALL_BOT_SCOPES].sort()).toEqual(
      manifestBotScopes().sort(),
    );
  });
});
