import { expect } from "@playwright/test";
import type { AgentState } from "api-server-api";

import { baseUrl } from "../config.js";
import type { ApiClient } from "./api-client.js";
import { getAccessToken } from "./auth.js";
import { deleteAgentIfPresent } from "./agents.js";
import {
  AGENT_NS,
  type AgentCr,
  applyAgentCr,
  kubectl,
  kubectlWithin,
  LOOKUP_TIMEOUT_MS,
  readAgentCr,
} from "./cluster.js";
import { type Backend, laneBackend } from "./lane.js";

export { type Backend, laneBackend };

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
  const install = await api.features.install.query();
  expect(
    install.virtualization,
    backend === "vm"
      ? "a vm project runs only against an install with virtualization.enabled; reinstall with E2E_VIRTUALIZATION=1"
      : "a container project runs only against an install without virtualization.enabled; reinstall without E2E_VIRTUALIZATION=1",
  ).toBe(backend === "vm");
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
    ...(backend === "container" ? { vm: false } : {}),
    ...(neverIdle ? { hibernationTimeoutMin: 0 } : {}),
  });
  expect(created.vm, `agent ${name} landed on the wrong backend`).toBe(
    backend === "vm",
  );
  return created.id;
}

// UNIT_BOUNDARY_DESCRIPTION: an install that can virtualize refuses every container create, so a spec that needs a container Agent gets one the way an operator does: the api-server assembles the spec for a throwaway Agent, and that spec is applied as an Agent object with the container backend under the name the spec asked for. The throwaway is deleted at once, so its machine and home leave nothing behind. Its spec was assembled for the vm backend, which drops the template's storageSize, runtimeClassName and nodeSelector, so a case that needs those passes them in `legacy`; the api-server's template view publishes none of them. What the create does beside the spec — connections, credentials, env — is not staged either.
export async function applyLegacyContainerAgent(
  api: ApiClient,
  id: string,
  name: string,
  templateId: string,
  legacy: {
    storageSize?: string;
    runtimeClassName?: string;
    nodeSelector?: Record<string, string>;
  } = {},
): Promise<void> {
  await deleteAgentIfPresent(api, `${name}-spec`);
  const source = await api.agents.create.mutate({
    name: `${name}-spec`,
    templateId,
    hibernationTimeoutMin: 0,
  });
  let cr: AgentCr;
  try {
    cr = readAgentCr(source.id);
  } finally {
    await api.agents.delete.mutate({ id: source.id });
  }
  const metadata = Object.fromEntries(
    Object.entries(cr.metadata).filter(
      ([key]) =>
        ![
          "resourceVersion",
          "uid",
          "creationTimestamp",
          "deletionTimestamp",
          "deletionGracePeriodSeconds",
          "generation",
          "managedFields",
          "ownerReferences",
          "finalizers",
        ].includes(key),
    ),
  );
  applyAgentCr({
    apiVersion: cr.apiVersion,
    kind: cr.kind,
    metadata: { ...metadata, name: id },
    spec: {
      ...cr.spec,
      name,
      backend: { type: "container" },
      ...(legacy.storageSize ? { storageSize: legacy.storageSize } : {}),
      ...(legacy.runtimeClassName
        ? { runtimeClassName: legacy.runtimeClassName }
        : {}),
      ...(legacy.nodeSelector ? { nodeSelector: legacy.nodeSelector } : {}),
    },
  });
}

export async function waitAgentState(
  api: ApiClient,
  agentId: string,
  state: AgentState,
  {
    timeoutMs = 240_000,
    failOnError = true,
  }: { timeoutMs?: number; failOnError?: boolean } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let agent: Awaited<ReturnType<typeof api.agents.get.query>>;
    try {
      agent = await api.agents.get.query({ id: agentId });
    } catch (e) {
      if (Date.now() > deadline)
        throw new Error(
          `agent ${agentId} did not reach ${state} in ${timeoutMs / 1000}s; the last read failed: ${(e as Error).message}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }
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

export async function mutateAgentFiles(
  token: () => Promise<string>,
  agentId: string,
  procedure: string,
  input: unknown,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(agentTrpcUrl(agentId, `files.${procedure}`), {
      method: "POST",
      headers: {
        authorization: `Bearer ${await token()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (res.status !== 502 || Date.now() > deadline) return res;
    console.log(
      `[e2e] files.${procedure} on ${agentId} answered 502, retrying: ${(await res.text()).slice(0, 200)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

export async function writeHomeFile(
  token: () => Promise<string>,
  agentId: string,
  path: string,
  content: string,
): Promise<void> {
  const res = await mutateAgentFiles(token, agentId, "write", {
    path,
    content,
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
  const started = Date.now();
  const res = await fetch(agentTrpcUrl(agentId, "sessions.list"), {
    headers: { authorization: `Bearer ${await token()}` },
    signal: AbortSignal.timeout(20_000),
  }).catch((err: unknown) => {
    throw new Error(
      `listing the sessions of ${agentId} got no answer after ${Date.now() - started}ms: ${String(err)}`,
    );
  });
  const body = await res.text();
  if (res.status !== 200)
    throw new Error(
      `listing the sessions of ${agentId} answered ${res.status} after ${Date.now() - started}ms: ${body.slice(0, 500)}`,
    );
  const parsed = JSON.parse(body) as {
    result: { data: { sessions: { sessionId: string }[] } };
  };
  const ids = parsed.result.data.sessions.map((s) => s.sessionId).sort();
  if (ids.length === 0)
    console.log(
      `[e2e] ${agentId} listed no session after ${Date.now() - started}ms: ${body.slice(0, 500)}`,
    );
  return ids;
}

function agentOwner(agentId: string): string {
  return kubectlWithin(
    LOOKUP_TIMEOUT_MS,
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

// UNIT_BOUNDARY_DESCRIPTION: the grows of the agent's machine that its VM runner logged as done, as the fields of each JSON log line: the RAM the guest booted with and the total it has once its virtio-mem driver plugged, and its agent onlined, all of the added RAM. The runner belongs to the agent's owner, so the lines are kept to the agent's own machine.
export function runnerGrows(
  agentId: string,
): { boot_mib: number; memory_mib: number }[] {
  const logs = kubectl(
    "-n",
    AGENT_NS,
    "logs",
    "-l",
    hostSelector(agentId, "vm"),
    "--tail=-1",
  );
  return logs.split("\n").flatMap((line) => {
    try {
      const { fields } = JSON.parse(line) as {
        fields?: Record<string, unknown>;
      };
      return fields?.machine === agentId &&
        fields.message === "the guest has all its added RAM online"
        ? [fields as { boot_mib: number; memory_mib: number }]
        : [];
    } catch {
      return [];
    }
  });
}

// UNIT_BOUNDARY_DESCRIPTION: the pod that hosts a vm agent's machine: its owner's VM runner, where the machine's disks, its share and its VMM are, and which is the only place the host side of a machine can be reached from.
export function runnerPod(agentId: string): string {
  return kubectlWithin(
    LOOKUP_TIMEOUT_MS,
    "-n",
    AGENT_NS,
    "get",
    "pod",
    "-l",
    hostSelector(agentId, "vm"),
    "-o",
    "jsonpath={.items[*].metadata.name}",
  ).split(" ")[0];
}

// UNIT_BOUNDARY_DESCRIPTION: runs a shell script as root on the agent's VM runner, as an operator with the pod would: the owner's claim is $HOME, and a machine's VMM is a `_boot-vm` child of the runner. A script that may run for minutes takes a deadline, so a command a full disk wedged cannot hold the suite.
export function onRunnerHost(
  agentId: string,
  script: string,
  { timeoutMs }: { timeoutMs?: number } = {},
): string {
  return kubectlWithin(
    timeoutMs,
    "-n",
    AGENT_NS,
    "exec",
    runnerPod(agentId),
    "-c",
    "vm-runner",
    "--",
    "sh",
    "-c",
    script,
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the deaths of this machine's VMMs that the agent's own runner reported, in the order it reported them, each with the number the kernel gives a signal — 9 is SIGKILL — and the pid the report names when it names one. A death the runner sees while the start call still runs fails that call, whose error names the signal; one after the call returns is the reaper's, which says the signal and the pid beside the machine. A kill lands on either side of that moment depending on how fast the machine boots, so both reports are read.
export function runnerKilledVmms(
  agentId: string,
): { signal: number; pid: number | null }[] {
  const logs = kubectlWithin(
    LOOKUP_TIMEOUT_MS,
    "-n",
    AGENT_NS,
    "logs",
    "-l",
    hostSelector(agentId, "vm"),
    "--tail=-1",
  );
  return logs.split("\n").flatMap((line) => {
    try {
      const { fields } = JSON.parse(line) as {
        fields?: Record<string, unknown>;
      };
      if (fields?.machine !== agentId) return [];
      if (
        fields.message === "machine action failed" &&
        fields.op === "starting" &&
        typeof fields.error === "string"
      )
        return fields.error.includes("killed by SIGKILL")
          ? [{ signal: 9, pid: null }]
          : [];
      return typeof fields.signal === "number" &&
        typeof fields.message === "string" &&
        fields.message.startsWith("vm runner: a machine's VMM was killed")
        ? [
            {
              signal: fields.signal,
              pid: typeof fields.pid === "number" ? fields.pid : null,
            },
          ]
        : [];
    } catch {
      return [];
    }
  });
}

// UNIT_BOUNDARY_DESCRIPTION: what provisions the claim the agent's runner keeps its machines' disks on, which is the owner's storage: the provisioner of the claim's StorageClass, the cluster's default class when the claim names none. A provisioner that hands out a directory of the node makes the claim part of the node's own disk, which nothing may fill.
export function runnerClaimProvisioner(agentId: string): string {
  const claim = kubectl(
    "-n",
    AGENT_NS,
    "get",
    "pod",
    runnerPod(agentId),
    "-o",
    String.raw`jsonpath={.spec.volumes[?(@.name=="state")].persistentVolumeClaim.claimName}`,
  );
  if (!claim) return "";
  const named = kubectl(
    "-n",
    AGENT_NS,
    "get",
    "pvc",
    claim,
    "-o",
    "jsonpath={.spec.storageClassName}",
  );
  const className = named
    ? named
    : kubectl(
        "-n",
        AGENT_NS,
        "get",
        "storageclass",
        "-o",
        String.raw`jsonpath={.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}`,
      );
  if (!className) return "";
  return kubectl(
    "-n",
    AGENT_NS,
    "get",
    "storageclass",
    className,
    "-o",
    "jsonpath={.provisioner}",
  );
}

// UNIT_BOUNDARY_DESCRIPTION: runs a shell script as root inside a vm agent's guest, through `vm-runner exec` on its owner's runner pod, and returns its output.
export function inGuest(
  agentId: string,
  script: string,
  { timeoutMs }: { timeoutMs?: number } = {},
): string {
  const pod = runnerPod(agentId);
  return kubectlWithin(
    timeoutMs,
    "-n",
    AGENT_NS,
    "exec",
    pod,
    "-c",
    "vm-runner",
    "--",
    "/usr/local/libexec/vm-runner/vm-runner",
    "exec",
    agentId,
    "--",
    "sh",
    "-c",
    script,
  );
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
      () => {
        try {
          return hostPods(selector).some(
            (p) => p.ready && !before.includes(p.uid),
          );
        } catch {
          return false;
        }
      },
      {
        timeout: 240_000,
        intervals: [3_000],
        message: `no replacement pod for agent ${agentId} became ready`,
      },
    )
    .toBe(true);
}
