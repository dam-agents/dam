import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import type { LocalSkill, Skill } from "api-server-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

export interface InstallSkillCall {
  source: string;
  name: string;
  version: string;
  skillPaths: string[];
}

export interface UninstallSkillCall {
  name: string;
  skillPaths: string[];
}

export interface PublishSkillCall {
  name: string;
  skillPaths: string[];
  owner: string;
  repo: string;
  title: string;
  body: string;
}

export interface PublishSkillResult {
  prUrl: string;
  branch: string;
}

/**
 * Upstream-error envelope agent-runtime emits via its tRPC `errorFormatter`
 * when OneCLI's gateway returns a structured error
 * (`app_not_connected` / `access_restricted` / …). The shape mirrors the
 * `data.upstream` field on the wire and is the only thing callers need to
 * extract `connect_url`/`manage_url` for the Connect-GitHub CTA.
 */
export interface UpstreamGatewayError {
  status: number;
  body?: {
    error?: string;
    message?: string;
    connect_url?: string;
    manage_url?: string;
    provider?: string;
  };
}

export interface InstallSkillResult {
  contentHash: string;
}

export interface AgentRuntimeSkillsClient {
  install(instanceId: string, token: string, body: InstallSkillCall): Promise<InstallSkillResult>;
  uninstall(instanceId: string, token: string, body: UninstallSkillCall): Promise<void>;
  listLocal(instanceId: string, token: string, skillPaths: string[]): Promise<LocalSkill[]>;
  publish(instanceId: string, token: string, body: PublishSkillCall): Promise<PublishSkillResult>;
  scan(instanceId: string, token: string, source: string): Promise<Skill[]>;
}

export class AgentRuntimeUpstreamError extends Error {
  constructor(message: string, public readonly upstream: UpstreamGatewayError) {
    super(message);
    this.name = "AgentRuntimeUpstreamError";
  }
}

function makeClient(instanceId: string, namespace: string, token: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://${podBaseUrl(instanceId, namespace)}/api/trpc`,
        headers: () => ({ Authorization: `Bearer ${token}` }),
      }),
    ],
  });
}

function isUpstreamGatewayError(value: unknown): value is UpstreamGatewayError {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof (value as { status: unknown }).status === "number"
  );
}

/**
 * Run a tRPC call and translate `data.upstream` (set by agent-runtime's
 * errorFormatter for OneCLI/GitHub gateway errors) into an
 * AgentRuntimeUpstreamError so callers can extract the CTA URL. Other tRPC
 * errors propagate as plain Error.
 */
async function runWithUpstreamMapping<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TRPCClientError) {
      const data = (e.data as { upstream?: unknown } | null) ?? null;
      const upstream = data?.upstream;
      if (isUpstreamGatewayError(upstream)) {
        throw new AgentRuntimeUpstreamError(`${label}: ${e.message}`, upstream);
      }
      throw new Error(`${label}: ${e.message}`);
    }
    throw new Error(`${label}: ${(e as Error).message}`);
  }
}

export function createAgentRuntimeSkillsClient(namespace: string): AgentRuntimeSkillsClient {
  return {
    install: (instanceId, token, body) =>
      runWithUpstreamMapping(`agent-runtime install ${instanceId}`, async () => {
        return makeClient(instanceId, namespace, token).skills.install.mutate(body);
      }),
    uninstall: (instanceId, token, body) =>
      runWithUpstreamMapping(`agent-runtime uninstall ${instanceId}`, async () => {
        await makeClient(instanceId, namespace, token).skills.uninstall.mutate(body);
      }),
    listLocal: async (instanceId, token, skillPaths) => {
      const { skills } = await runWithUpstreamMapping(
        `agent-runtime listLocal ${instanceId}`,
        () => makeClient(instanceId, namespace, token).skills.listLocal.query({ skillPaths }),
      );
      return skills;
    },
    publish: (instanceId, token, body) =>
      runWithUpstreamMapping(`agent-runtime publish ${instanceId}`, () =>
        makeClient(instanceId, namespace, token).skills.publish.mutate(body),
      ),
    scan: async (instanceId, token, source) => {
      const { skills } = await runWithUpstreamMapping(
        `agent-runtime scan ${instanceId}`,
        () => makeClient(instanceId, namespace, token).skills.scan.mutate({ source }),
      );
      return skills as Skill[];
    },
  };
}
