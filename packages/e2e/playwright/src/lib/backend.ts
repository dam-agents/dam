import { expect } from "@playwright/test";
import type { AgentState } from "api-server-api";

import { baseUrl } from "../config.js";
import type { ApiClient } from "./api-client.js";
import { getAccessToken } from "./auth.js";
import { AGENT_NS, kubectl } from "./cluster.js";
import { type Backend, laneBackend } from "./lane.js";

export { type Backend, laneBackend };

export function onLaneBackend<T extends object>(input: T): T & { vm?: true } {
  return laneBackend === "vm" ? { ...input, vm: true } : input;
}

export function bootTimeoutMs(containerMs: number): number {
  return laneBackend === "vm" ? containerMs * 3 : containerMs;
}

export async function setVmSandboxes(
  api: ApiClient,
  enabled: boolean,
): Promise<void> {
  const flags = await api.features.setFlag.mutate({
    feature: "vm-sandboxes",
    enabled,
  });
  expect(flags["vm-sandboxes"], "the vm-sandboxes experiment flag").toBe(
    enabled,
  );
}

const tokenMaxAgeMs = 120_000;

export function refreshingToken(): () => Promise<string> {
  let token: Promise<string> | undefined;
  let mintedAt = 0;
  return () => {
    if (!token || Date.now() - mintedAt > tokenMaxAgeMs) {
      mintedAt = Date.now();
      token = getAccessToken();
      token.catch(() => {
        token = undefined;
      });
    }
    return token;
  };
}

export async function requireBackend(
  api: ApiClient,
  backend: Backend,
): Promise<void> {
  if (backend !== "vm") return;
  const install = await api.features.install.query();
  expect(
    install.virtualization,
    "a vm project runs only against an install with virtualization.enabled; reinstall with E2E_VIRTUALIZATION=1",
  ).toBe(true);
}

export async function createAgentOn(
  api: ApiClient,
  backend: Backend,
  name: string,
  templateId: string,
  { neverIdle = false }: { neverIdle?: boolean } = {},
): Promise<string> {
  const created = await api.agents.create.mutate({
    name,
    templateId,
    ...(backend === "vm" ? { vm: true } : {}),
    ...(neverIdle ? { hibernationTimeoutMin: 0 } : {}),
  });
  expect(created.vm, `agent ${name} landed on the wrong backend`).toBe(
    backend === "vm",
  );
  return created.id;
}

export async function waitAgentState(
  api: ApiClient,
  agentId: string,
  state: AgentState,
  {
    timeoutMs = 600_000,
    failOnError = true,
  }: { timeoutMs?: number; failOnError?: boolean } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const agent = await api.agents.get.query({ id: agentId });
    if (agent.state === state) return;
    if (failOnError && agent.state === "error")
      throw new Error(
        `agent ${agentId} failed on its way to ${state}: ${agent.error ?? agent.podTerminationReason ?? "no reason reported"}`,
      );
    if (Date.now() > deadline)
      throw new Error(
        `agent ${agentId} did not reach ${state} in ${timeoutMs / 1000}s; it is ${agent.state}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

function agentTrpcUrl(agentId: string, procedure: string): string {
  return `${baseUrl}/api/agents/${encodeURIComponent(agentId)}/trpc/${procedure}`;
}

export async function writeHomeFile(
  token: () => Promise<string>,
  agentId: string,
  path: string,
  content: string,
): Promise<void> {
  const res = await fetch(agentTrpcUrl(agentId, "files.write"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${await token()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ path, content }),
  });
  if (res.status !== 200)
    throw new Error(
      `writing ${path} on ${agentId} answered ${res.status}: ${(await res.text()).slice(0, 500)}`,
    );
}

export async function readHomeFile(
  token: () => Promise<string>,
  agentId: string,
  path: string,
): Promise<string> {
  const input = encodeURIComponent(JSON.stringify({ path }));
  const res = await fetch(
    `${agentTrpcUrl(agentId, "files.read")}?input=${input}`,
    {
      headers: { authorization: `Bearer ${await token()}` },
    },
  );
  const body = await res.text();
  if (res.status !== 200)
    throw new Error(
      `reading ${path} on ${agentId} answered ${res.status}: ${body.slice(0, 500)}`,
    );
  const parsed = JSON.parse(body) as {
    result: { data: { content: string; binary: boolean } };
  };
  expect(parsed.result.data.binary, `${path} read back as binary`).toBe(false);
  return parsed.result.data.content;
}

export async function expectHomeFile(
  token: () => Promise<string>,
  agentId: string,
  path: string,
  expected: string,
  { timeoutMs = 600_000 }: { timeoutMs?: number } = {},
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return await readHomeFile(token, agentId, path);
        } catch (e) {
          return `unreadable: ${(e as Error).message}`;
        }
      },
      {
        timeout: timeoutMs,
        intervals: [5_000],
        message: `${path} in the agent's HOME did not read back as written`,
      },
    )
    .toBe(expected);
}

export async function listSessionIds(
  token: () => Promise<string>,
  agentId: string,
): Promise<string[]> {
  const res = await fetch(agentTrpcUrl(agentId, "sessions.list"), {
    headers: { authorization: `Bearer ${await token()}` },
  });
  const body = await res.text();
  if (res.status !== 200)
    throw new Error(
      `listing the sessions of ${agentId} answered ${res.status}: ${body.slice(0, 500)}`,
    );
  const parsed = JSON.parse(body) as {
    result: { data: { sessions: { sessionId: string }[] } };
  };
  return parsed.result.data.sessions.map((s) => s.sessionId).sort();
}

function agentOwner(agentId: string): string {
  return kubectl(
    "-n",
    AGENT_NS,
    "get",
    "agents.agent-platform.ai",
    agentId,
    "-o",
    "jsonpath={.metadata.labels.agent-platform\\.ai/owner}",
  );
}

function hostSelector(agentId: string, backend: Backend): string {
  if (backend === "vm")
    return `app.kubernetes.io/component=vm-runner,agent-platform.ai/owner=${agentOwner(agentId)}`;
  return `statefulset.kubernetes.io/pod-name=${agentId}-0`;
}

function hostPods(selector: string): { uid: string; ready: boolean }[] {
  const out = kubectl(
    "-n",
    AGENT_NS,
    "get",
    "pod",
    "-l",
    selector,
    "-o",
    'jsonpath={range .items[*]}{.metadata.uid}{" "}{.status.conditions[?(@.type=="Ready")].status}{"\\n"}{end}',
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [uid = "", ready = ""] = line.split(" ");
      return { uid, ready: ready === "True" };
    });
}

export async function deleteBackendHost(
  agentId: string,
  backend: Backend,
): Promise<void> {
  const selector = hostSelector(agentId, backend);
  const before = hostPods(selector).map((p) => p.uid);
  expect(
    before.length,
    `no pod hosts agent ${agentId} (selector ${selector})`,
  ).toBeGreaterThan(0);
  kubectl(
    "-n",
    AGENT_NS,
    "delete",
    "pod",
    "-l",
    selector,
    "--wait=true",
    "--timeout=180s",
  );
  await expect
    .poll(
      () => hostPods(selector).some((p) => p.ready && !before.includes(p.uid)),
      {
        timeout: 600_000,
        intervals: [3_000],
        message: `no replacement pod for agent ${agentId} became ready`,
      },
    )
    .toBe(true);
}
