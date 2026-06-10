import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type {
  E2eService,
  SlackFireCommandInput,
  SlackFireMentionInput,
  SlackOutboundRecord,
} from "api-server-api";
import type { AppRouter as MockAppRouter } from "mock-agent-api";
import WS from "ws";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

export interface SlackE2eControl {
  fireMention(event: SlackFireMentionInput): Promise<void>;
  fireCommand(command: SlackFireCommandInput): Promise<string>;
  readOutbound(): SlackOutboundRecord[];
  resetOutbound(): void;
}

export function createE2eService(deps: {
  namespace: string;
  slack?: SlackE2eControl;
}): E2eService {
  function requireSlack(): SlackE2eControl {
    if (!deps.slack) {
      throw new Error("slack e2e control is not available on this deployment");
    }
    return deps.slack;
  }

  async function withClient<T>(
    agentId: string,
    fn: (
      client: ReturnType<typeof createTRPCClient<MockAppRouter>>,
    ) => Promise<T>,
  ): Promise<T> {
    const url = `ws://${podBaseUrl(agentId, deps.namespace)}/api/acp`;
    const wsClient = createWSClient({
      url,
      WebSocket: WS as unknown as typeof WebSocket,
      lazy: { enabled: false, closeMs: 0 },
    });
    const client = createTRPCClient<MockAppRouter>({
      links: [wsLink({ client: wsClient })],
    });
    try {
      return await fn(client);
    } finally {
      wsClient.close();
    }
  }

  return {
    setScript: (agentId, input) =>
      withClient(agentId, (c) => c.scriptedMock.setScript.mutate(input)),
    getReceivedPrompts: (agentId) =>
      withClient(agentId, (c) => c.scriptedMock.getReceivedPrompts.query()),
    reset: (agentId) =>
      withClient(agentId, (c) => c.scriptedMock.reset.mutate()),
    getEnv: (agentId, name) =>
      withClient(agentId, (c) => c.scriptedMock.getEnv.query({ name })),
    performFetch: (agentId, input) =>
      withClient(agentId, (c) => c.scriptedMock.performFetch.mutate(input)),
    slackFireMention: async (input) => {
      await requireSlack().fireMention(input);
      return { ok: true };
    },
    slackFireCommand: async (input) => {
      const ack = await requireSlack().fireCommand(input);
      return { ack };
    },
    slackReadOutbound: async () => ({
      records: requireSlack().readOutbound(),
    }),
    slackResetOutbound: async () => {
      requireSlack().resetOutbound();
      return { ok: true };
    },
  };
}
