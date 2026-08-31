import { AGENT_IDS } from "./agents.js";

const now = Date.now();
const min = 60_000;

export const approvals = [
  {
    id: "appr-net-1",
    type: "ext_authz" as const,
    agentId: AGENT_IDS.docsReviewer,
    sessionId: "chat-flaky-test",
    payload: {
      kind: "ext_authz" as const,
      host: "api.github.com",
      method: "POST",
      path: "/repos/acme/docs/issues",
    },
    createdAt: new Date(now - 2 * min).toISOString(),
    expiresAt: new Date(now + 28 * min).toISOString(),
    resolvedAt: null,
    verdict: null,
    status: "pending" as const,
  },
  {
    id: "appr-cmd-1",
    type: "acp_native" as const,
    agentId: AGENT_IDS.metricsHelper,
    sessionId: "chat-metrics",
    payload: {
      kind: "acp_native" as const,
      toolName: "Bash",
      args: { command: "pip install pandas openpyxl" },
    },
    createdAt: new Date(now - 3 * min).toISOString(),
    expiresAt: new Date(now + 27 * min).toISOString(),
    resolvedAt: null,
    verdict: null,
    status: "pending" as const,
  },
  {
    id: "appr-net-2",
    type: "ext_authz" as const,
    agentId: AGENT_IDS.releaseNotes,
    sessionId: "exp-run-12",
    payload: {
      kind: "ext_authz" as const,
      host: "huggingface.co",
      method: "GET",
      path: "/api/models/meta-llama/Llama-3-8B",
    },
    createdAt: new Date(now - 45 * min).toISOString(),
    expiresAt: new Date(now - 15 * min).toISOString(),
    resolvedAt: null,
    verdict: null,
    status: "expired" as const,
  },
];
