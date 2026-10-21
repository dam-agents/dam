/**
 * TEST_OVERVIEW: The working status on a turn is the thread's Slack agent
 * session. Slack shows its Stop button only on a session in `processing`, so
 * the gateway sets the status with agents.sessions.setStatus: a status text
 * becomes `processing`, and a cleared status becomes `active`. An app not yet
 * moved to agent messaging refuses that call, and the gateway then sets the
 * same status with assistant.threads.setStatus, so the status still shows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { client } = vi.hoisted(() => ({
  client: {
    agents: { sessions: { setStatus: null as unknown } },
    assistant: { threads: { setStatus: null as unknown } },
  },
}));

vi.mock("@slack/bolt", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  App: class {
    client = client;
    event() {}
    command() {}
    view() {}
    error() {}
    async start() {}
    async stop() {}
  },
}));

import { createBoltSlackGateway } from "../../modules/channels/infrastructure/bolt-slack-gateway.js";
import type { SlackGatewayHandlers } from "../../modules/channels/infrastructure/slack-gateway.js";

function slackRefusal(error: string) {
  return Object.assign(new Error(`An API error occurred: ${error}`), {
    code: "slack_webapi_platform_error",
    data: { ok: false, error },
  });
}

async function startedGateway() {
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
  await gateway.start({} as SlackGatewayHandlers);
  return gateway;
}

const thread = { channel: "C1", threadTs: "100.1", teamId: "T1" };

let sessionStatus: ReturnType<typeof vi.fn>;
let assistantStatus: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStatus = vi.fn(async () => ({ ok: true }));
  assistantStatus = vi.fn(async () => ({ ok: true }));
  client.agents.sessions.setStatus = sessionStatus;
  client.assistant.threads.setStatus = assistantStatus;
});

describe("Slack working status", () => {
  /**
   * TEST_SCENARIO: A turn starts working, then ends. The session goes to
   * `processing`, which carries the Stop button, and then to `active`, so
   * Slack does not keep it working for its one-hour timeout. The legacy
   * assistant API is not called.
   */
  it("sets the agent session to processing, then active", async () => {
    const gateway = await startedGateway();

    await gateway.setStatus({ ...thread, status: "is thinking…" });
    await gateway.setStatus({ ...thread, status: "" });

    expect(sessionStatus.mock.calls).toEqual([
      [
        {
          token: "xoxb-test",
          channel_id: "C1",
          thread_ts: "100.1",
          status: "processing",
        },
      ],
      [
        {
          token: "xoxb-test",
          channel_id: "C1",
          thread_ts: "100.1",
          status: "active",
        },
      ],
    ]);
    expect(assistantStatus).not.toHaveBeenCalled();
  });

  /**
   * TEST_SCENARIO: The app still declares assistant_view, so Slack refuses
   * agents.sessions.setStatus. The status text and its clearing go through
   * assistant.threads.setStatus instead, and the turn sees no error.
   */
  it("falls back to the assistant status on an app without agent messaging", async () => {
    sessionStatus.mockRejectedValue(slackRefusal("not_authorized"));
    const gateway = await startedGateway();

    await gateway.setStatus({ ...thread, status: "Read file" });
    await gateway.setStatus({ ...thread, status: "" });

    expect(assistantStatus.mock.calls).toEqual([
      [
        {
          token: "xoxb-test",
          channel_id: "C1",
          thread_ts: "100.1",
          status: "Read file",
        },
      ],
      [
        {
          token: "xoxb-test",
          channel_id: "C1",
          thread_ts: "100.1",
          status: "",
        },
      ],
    ]);
  });

  /**
   * TEST_SCENARIO: The call fails without an answer from Slack, for example
   * on a network error. Nothing is learned about the app, so the error goes
   * to the turn presenter, which stops the status for that turn.
   */
  it("passes on a failure that is not a Slack refusal", async () => {
    sessionStatus.mockRejectedValue(new Error("socket hang up"));
    const gateway = await startedGateway();

    await expect(
      gateway.setStatus({ ...thread, status: "is thinking…" }),
    ).rejects.toThrow("socket hang up");
    expect(assistantStatus).not.toHaveBeenCalled();
  });
});
