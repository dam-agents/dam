/**
 * TEST_OVERVIEW: The Slack gateway opens its Bolt App at INFO. Bolt passes that
 * one level to its own logger, to the WebClient the App calls Slack through,
 * and to the Socket Mode receiver, so INFO is the level every install runs at
 * and nothing raises it without a code change.
 */
import { describe, expect, it, vi } from "vitest";

const { appOptions } = vi.hoisted(() => ({
  appOptions: [] as Array<{ logLevel?: unknown }>,
}));

vi.mock("@slack/bolt", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  App: class {
    client = {} as never;
    constructor(options: { logLevel?: unknown }) {
      appOptions.push(options);
    }
    event() {}
    command() {}
    view() {}
    error() {}
    async start() {}
    async stop() {}
  },
}));

import { LogLevel } from "@slack/bolt";
import { createBoltSlackGateway } from "../../modules/channels/infrastructure/bolt-slack-gateway.js";
import type { SlackGatewayHandlers } from "../../modules/channels/infrastructure/slack-gateway.js";

describe("Slack Bolt logging", () => {
  it("opens the App at INFO", async () => {
    const gateway = createBoltSlackGateway({
      resolveBotToken: async () => "xoxb-test",
      importHelmToken: async () => {},
      renewTokens: async () => {},
      forgetBotToken: () => {},
      helmBotToken: null,
      appToken: "xapp-test",
      commandName: "/platform",
      onCredentialRejected: async () => {},
    });

    expect(await gateway.start({} as SlackGatewayHandlers)).toBe(true);
    expect(appOptions.at(-1)?.logLevel).toBe(LogLevel.INFO);
  });
});
