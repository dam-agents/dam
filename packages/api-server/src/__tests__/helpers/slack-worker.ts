import type { AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import {
  createFakeSlackGateway,
  type FakeSlackChannel,
} from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type { AcpClient, AcpSessionInfo } from "../../core/acp-client.js";
import type { SlackDmBridgePort } from "../../modules/channels/infrastructure/slack.js";
import type { SlackOwnedThreads } from "../../modules/channels/infrastructure/slack-owned-threads-repository.js";
import type { AgentWorkspaceFilesFactory } from "../../modules/channels/infrastructure/agent-workspace-files.js";
import type { ChannelPair } from "../../modules/channels/infrastructure/channel-profile.js";
import { stubTurnAttendance } from "./turn-attendance.js";
import { stubWorkspaceFiles } from "./workspace-files.js";
import { noArtifacts } from "./artifact-links.js";

export const SLACK_HARNESS_OWNER = "kc|owner-1";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One bound Slack agent wired to the fake gateway,
 * capturing the prompts the relay sends. Specs share it so the stub deps for
 * createSlackWorker are spelled out in one place.
 */
export function slackWorkerHarness(
  opts: {
    boundChannelId?: string;
    agentNames?: Record<string, string>;
    channels?: FakeSlackChannel[];
    ambient?: boolean;
    history?: boolean;
    otherBound?: string[];
    linkedSub?: string;
    linkedSlackUsers?: string[];
    sessions?: AcpSessionInfo[];
    settleMs?: number;
    makeAcp?: (base: AcpClient) => AcpClient;
    workspaceFiles?: AgentWorkspaceFilesFactory;
    channelPair?: ChannelPair;
    dmBridges?: SlackDmBridgePort;
    ownedThreads?: SlackOwnedThreads;
    ensureReady?: () => Promise<void>;
    reportSession?: boolean;
    connected?: () => boolean;
    unbindSlackChannel?: (agentId: string, channelId: string) => Promise<void>;
  } = {},
) {
  const boundChannelId = opts.boundChannelId ?? "C1";
  const history = { on: opts.history ?? false };
  const historyCalls: Array<{
    agentId: string;
    channelId: string;
    history: boolean;
  }> = [];
  const agentNames = opts.agentNames ?? { "agent-1": "Helper" };
  const gw = createFakeSlackGateway();
  if (opts.channels) gw.setChannels(opts.channels);
  const prompts: Array<string | ContentBlock[]> = [];
  const created: AcpSessionInfo[] = [];
  const baseAcp: AcpClient = {
    steer: async () => "unsupported" as const,
    listSessions: async () => [...created, ...(opts.sessions ?? [])],
    sendPrompt: async (prompt, sendOpts) => {
      prompts.push(prompt);
      /* TEST_SCENARIO: a runtime reports the turn's session and prompt as it
       * starts one, which is what lets a later message steer it and what a
       * recovery nudge is watched against. */
      if (opts.reportSession) {
        const session =
          "sessionId" in sendOpts && sendOpts.sessionId
            ? String(sendOpts.sessionId)
            : `s-${created.length + 1}`;
        sendOpts.onSession?.(session, `p-${prompts.length}`);
      }
      if ("platformMeta" in sendOpts && sendOpts.platformMeta) {
        created.push({
          sessionId: `s-${created.length + 1}`,
          platform: sendOpts.platformMeta,
        } as AcpSessionInfo);
      }
      return "the answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
    turnStatus: async () => "unknown" as const,
  };
  const acp = opts.makeAcp?.(baseAcp) ?? baseAcp;
  const agents = {
    ensureReady: opts.ensureReady ?? (async () => {}),
    get: async (id: string) =>
      agentNames[id]
        ? { id, name: agentNames[id], spec: { whispersOff: false } }
        : null,
  } as unknown as AgentsService;

  const worker = createSlackWorker({
    makeAcpClient: () => acp,
    ...(opts.channelPair ? { channelPair: opts.channelPair } : {}),
    createGateway: () => gw,
    agents: () => agents,
    identityLinks: {
      resolve: async () => opts.linkedSub ?? null,
      externalUsersOf: async () => opts.linkedSlackUsers ?? [],
      externalLinksOf: async () =>
        (opts.linkedSlackUsers ?? []).map((externalUserId) => ({
          externalUserId,
          teamId: null,
          source: "oauth" as const,
        })),
    } as never,
    oauthConfig: { authUrl: "http://kc", clientId: "c" } as never,
    pendingOAuthFlows: createMemoryTtlStore(600_000),
    getInstanceOwner: async () => SLACK_HARNESS_OWNER,
    ownerDisplayName: async () => null,
    channelRegistry: {
      resolveSlackBindings: async () =>
        opts.connected?.() === false
          ? []
          : [
              {
                instanceName: "agent-1",
                owner: SLACK_HARNESS_OWNER,
                ambient: opts.ambient ?? false,
                history: history.on,
                isDefault: true,
              },
            ],
      resolveSlackChannelsByInstance: async () => [
        {
          id: boundChannelId,
          teamId: "",
          ...(history.on ? { history: true as const } : {}),
        },
        ...(opts.otherBound ?? []).map((id) => ({ id, teamId: "" })),
      ],
    } as never,
    unbindSlackChannel: opts.unbindSlackChannel ?? (async () => {}),
    ...(opts.dmBridges ? { dmBridges: opts.dmBridges } : {}),
    setSlackChannelAmbient: async () => {},
    setSlackChannelHistory: async (agentId, channelId, on) => {
      historyCalls.push({ agentId, channelId, history: on });
      history.on = on;
    },
    agentsFor: () => ({}) as never,
    ignoredApps: {
      list: async () => [],
      ignore: async () => true,
      unignore: async () => true,
    },
    setSlackDefault: async () => true,
    brand: { name: "DAM", short: "dam" },
    isTermsAccepted: async () => true,
    uiBaseUrl: "http://ui",
    linkArtifacts: noArtifacts,
    attendance: stubTurnAttendance(),
    workspaceFiles: opts.workspaceFiles ?? stubWorkspaceFiles(),
    listWorkspaces: async () => [],
    emit: () => {},
    settleMs: opts.settleMs ?? 0,
    ...(opts.ownedThreads ? { ownedThreads: opts.ownedThreads } : {}),
  });

  async function settled(done: () => boolean): Promise<boolean> {
    for (let i = 0; i < 100 && !done(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return done();
  }

  return { gw, prompts, created, worker, settled, history, historyCalls };
}
