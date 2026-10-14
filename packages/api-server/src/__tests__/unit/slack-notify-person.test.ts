// TEST_OVERVIEW: The platform's own Slack send to a person: one direct message per linked Slack identity, posted as the app, and nothing for a user with no link, no reachable workspace or no im:write.
import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { configureLogger } from "../../core/logger.js";
import type { AcpClient } from "../../core/acp-client.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type { ExternalLink } from "../../modules/channels/services/identity-link-service.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";

configureLogger({ level: "error", write: () => {} });

async function harness(links: ExternalLink[], workspaces: string[]) {
  const gw = createFakeSlackGateway();
  const worker = createSlackWorker({
    makeAcpClient: () => ({}) as AcpClient,
    createGateway: () => gw,
    agents: () => ({}) as AgentsService,
    identityLinks: {
      resolve: async () => null,
      externalUsersOf: async () => links.map((l) => l.externalUserId),
      externalLinksOf: async () => links,
    } as never,
    oauthConfig: { authUrl: "http://kc", clientId: "c" } as never,
    pendingOAuthFlows: createMemoryTtlStore(600_000),
    getInstanceOwner: async () => null,
    channelRegistry: {
      resolveSlackBindings: async () => [],
      resolveSlackChannelsByInstance: async () => [],
    },
    unbindSlackChannel: async () => {},
    setSlackChannelAmbient: async () => {},
    ignoredApps: {
      list: async () => [],
      ignore: async () => true,
      unignore: async () => true,
    },
    setSlackDefault: async () => true,
    brand: { name: "DAM", short: "dam" },
    isTermsAccepted: async () => true,
    uiBaseUrl: "http://ui",
    attendance: stubTurnAttendance(),
    workspaceFiles: stubWorkspaceFiles(),
    listWorkspaces: async () => workspaces,
    emit: () => {},
  });
  await worker.connect();
  const dms = () => gw.readOutbound().filter((r) => r.kind === "message");
  return { gw, worker, dms };
}

describe("slack notifyPerson", () => {
  // TEST_SCENARIO: A person linked in two workspaces gets one direct message in each, in the workspace each link recorded.
  it("sends one direct message per linked identity", async () => {
    const h = await harness(
      [
        { externalUserId: "U1", teamId: "T1" },
        { externalUserId: "U2", teamId: "T2" },
      ],
      ["T1", "T2"],
    );
    expect(await h.worker.notifyPerson("kc|a", "storage is full")).toEqual({
      sent: 2,
    });
    expect(h.dms()).toMatchObject([
      { channel: "D-U1", teamId: "T1", text: "storage is full" },
      { channel: "D-U2", teamId: "T2", text: "storage is full" },
    ]);
  });

  // TEST_SCENARIO: An unlinked user has nobody to message; the call answers zero and posts nothing.
  it("sends nothing to an unlinked user", async () => {
    const h = await harness([], ["T1"]);
    expect(await h.worker.notifyPerson("kc|a", "x")).toEqual({ sent: 0 });
    expect(h.dms()).toHaveLength(0);
  });

  // TEST_SCENARIO: A link made before links recorded their workspace reaches the one active install, and nothing when several are active.
  it("falls back to the only active workspace for a legacy link", async () => {
    const one = await harness([{ externalUserId: "U1", teamId: null }], ["T1"]);
    expect(await one.worker.notifyPerson("kc|a", "x")).toEqual({ sent: 1 });
    expect(one.dms()).toMatchObject([{ teamId: "T1" }]);

    const two = await harness(
      [{ externalUserId: "U1", teamId: null }],
      ["T1", "T2"],
    );
    expect(await two.worker.notifyPerson("kc|a", "x")).toEqual({ sent: 0 });
  });

  // TEST_SCENARIO: A link whose workspace is no longer active, or one that did not grant im:write, is skipped.
  it("skips an inactive workspace and one without im:write", async () => {
    const gone = await harness(
      [{ externalUserId: "U1", teamId: "T9" }],
      ["T1"],
    );
    expect(await gone.worker.notifyPerson("kc|a", "x")).toEqual({ sent: 0 });

    const noScope = await harness(
      [{ externalUserId: "U1", teamId: "T1" }],
      ["T1"],
    );
    noScope.gw.setGrantedScopes(["chat:write"]);
    expect(await noScope.worker.notifyPerson("kc|a", "x")).toEqual({
      sent: 0,
    });
  });
});
