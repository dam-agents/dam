// FIXTURE_ONLY: data for the prototype — real source is undecided.

export interface KbExample {
  intentId: string;
  name: string;
  connectionLabel: string;
  connectionDetail: string;
  channelLabel: string;
  channelDetail: string;
  seedMessages: Array<{ role: "user" | "assistant"; content: string }>;
  suggestedPrompt: string;
}

export const KB_EXAMPLE: KbExample = {
  intentId: "repo",
  name: "sample-platform-docs",
  connectionLabel: "GitHub",
  connectionDetail: "dam-agents/dam",
  channelLabel: "Slack",
  channelDetail: "#platform-help",
  seedMessages: [
    {
      role: "user",
      content: "How is the API server structured?",
    },
    {
      role: "assistant",
      content:
        "The API server is a tRPC application in `packages/api-server/`. It exposes routers for agents, connections, sessions, and providers. Each router lives in its own file under `src/routers/` and is composed into the root `appRouter`. The server runs inside the platform pod alongside the UI, sharing the same Kubernetes service.",
    },
  ],
  suggestedPrompt: "What networking rules apply to agent containers?",
};

export function getExampleForIntent(): KbExample {
  return KB_EXAMPLE;
}
