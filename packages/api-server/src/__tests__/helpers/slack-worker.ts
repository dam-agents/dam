import type { AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import {
  createFakeSlackGateway,
  type FakeSlackChannel,
} from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type { AcpClient, AcpSessionInfo } from "../../core/acp-client.js";
import { stubTurnAttendance } from "./turn-attendance.js";
import { stubWorkspaceFiles } from "./workspace-files.js";

export const SLACK_HARNESS_OWNER = "kc|owner-1";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One bound Slack agent wired to the fake gateway,
 * capturing the prompts the relay sends. Specs share it so createSlackWorker's
 * positional argument list is spelled out in one place.
 */
export function slackWorkerHarness(
  opts: {
    boundChannelId?: string;
    agentNames?: Record<string, string>;
    channels?: FakeSlackChannel[];
    ambient?: boolean;
    settleMs?: number;
    makeAcp?: (base: AcpClient) => AcpClient;
  } = {},
) {
  const boundChannelId = opts.boundChannelId ?? "C1";
  const agentNames = opts.agentNames ?? { "agent-1": "Helper" };
  const gw = createFakeSlackGateway();
  if (opts.channels) gw.setChannels(opts.channels);
  const prompts: Array<string | ContentBlock[]> = [];
  const created: AcpSessionInfo[] = [];
  const baseAcp: AcpClient = {
    steer: async () => "unsupported" as const,
    listSessions: async () => [...created],
    sendPrompt: async (prompt, sendOpts) => {
      prompts.push(prompt);
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
    ensureReady: async () => {},
    get: async (id: string) =>
      agentNames[id] ? { id, name: agentNames[id] } : null,
  } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => null } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => SLACK_HARNESS_OWNER,
    {
      resolveSlackBindings: async () => [
        {
          instanceName: "agent-1",
          owner: SLACK_HARNESS_OWNER,
          ambient: opts.ambient ?? false,
          isDefault: true,
        },
      ],
      resolveSlackChannelsByInstance: async () => [
        { id: boundChannelId, teamId: "" },
      ],
    } as never,
    async () => {},
    async () => {},
    async () => true,
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    stubTurnAttendance(),
    stubWorkspaceFiles(),
    (teamId) => teamId,
    () => {},
    opts.settleMs ?? 0,
  );

  async function settled(done: () => boolean): Promise<boolean> {
    for (let i = 0; i < 100 && !done(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return done();
  }

  return { gw, prompts, worker, settled };
}
