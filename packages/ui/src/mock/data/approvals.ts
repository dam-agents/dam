import { AGENT_IDS } from "./agents.js";

const now = Date.now();
const min = 60_000;

export const approvals = [
  // Pending: ext_authz network request
  {
    id: "apr-0001",
    type: "ext_authz" as const,
    agentId: AGENT_IDS.codexResearch,
    sessionId: "sess-001",
    payload: {
      kind: "ext_authz" as const,
      host: "api.github.com",
      method: "GET",
      path: "/repos/acme-org/my-repo/contents/README.md",
    },
    createdAt: new Date(now - 2 * min).toISOString(),
    expiresAt: new Date(now + 28_000).toISOString(),
    resolvedAt: null,
    verdict: null,
    status: "pending" as const,
  },
  // Pending: ext_authz POST
  {
    id: "apr-0002",
    type: "ext_authz" as const,
    agentId: AGENT_IDS.claudeCodeMain,
    sessionId: "sess-002",
    payload: {
      kind: "ext_authz" as const,
      host: "registry.npmjs.org",
      method: "POST",
      path: "/v2/@acme/shared-lib",
    },
    createdAt: new Date(now - 5 * min).toISOString(),
    expiresAt: new Date(now + 55_000).toISOString(),
    resolvedAt: null,
    verdict: null,
    status: "pending" as const,
  },
  // Pending: acp_native tool request
  {
    id: "apr-0003",
    type: "acp_native" as const,
    agentId: AGENT_IDS.geminiPipeline,
    sessionId: "sess-003",
    payload: {
      kind: "acp_native" as const,
      toolName: "execute_shell_command",
      args: { command: "pip install pandas==2.1.0" },
    },
    createdAt: new Date(now - 8 * min).toISOString(),
    expiresAt: new Date(now + 52_000).toISOString(),
    resolvedAt: null,
    verdict: null,
    status: "pending" as const,
  },
  // Resolved: allowed permanently
  {
    id: "apr-0004",
    type: "ext_authz" as const,
    agentId: AGENT_IDS.codexResearch,
    sessionId: "sess-001",
    payload: {
      kind: "ext_authz" as const,
      host: "api.github.com",
      method: "GET",
      path: "/repos/acme-org/my-repo/pulls",
    },
    createdAt: new Date(now - 12 * min).toISOString(),
    expiresAt: new Date(now - 10 * min).toISOString(),
    resolvedAt: new Date(now - 11 * min).toISOString(),
    verdict: "allow" as const,
    status: "resolved" as const,
  },
  // Resolved: allowed host-wide
  {
    id: "apr-0005",
    type: "ext_authz" as const,
    agentId: AGENT_IDS.claudeCodeMain,
    sessionId: "sess-002",
    payload: {
      kind: "ext_authz" as const,
      host: "registry.npmjs.org",
      method: "GET",
      path: "/*",
    },
    createdAt: new Date(now - 60 * min).toISOString(),
    expiresAt: new Date(now - 58 * min).toISOString(),
    resolvedAt: new Date(now - 59 * min).toISOString(),
    verdict: "allow" as const,
    status: "resolved" as const,
  },
  // Resolved: denied permanently
  {
    id: "apr-0006",
    type: "ext_authz" as const,
    agentId: AGENT_IDS.codexResearch,
    sessionId: "sess-001",
    payload: {
      kind: "ext_authz" as const,
      host: "evil-domain.io",
      method: "POST",
      path: "/exfiltrate",
    },
    createdAt: new Date(now - 180 * min).toISOString(),
    expiresAt: new Date(now - 178 * min).toISOString(),
    resolvedAt: new Date(now - 179 * min).toISOString(),
    verdict: "deny" as const,
    status: "resolved" as const,
  },
  // Expired
  {
    id: "apr-0007",
    type: "ext_authz" as const,
    agentId: AGENT_IDS.codexResearch,
    sessionId: "sess-001",
    payload: {
      kind: "ext_authz" as const,
      host: "internal-api.corp.net",
      method: "GET",
      path: "/v2/secrets",
    },
    createdAt: new Date(now - 24 * 60 * min).toISOString(),
    expiresAt: new Date(now - 24 * 60 * min + 60_000).toISOString(),
    resolvedAt: null,
    verdict: null,
    status: "expired" as const,
  },
];
