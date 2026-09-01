import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter, SourcePathReason } from "agent-runtime-api";
import { SOURCE_PATH_REASONS } from "agent-runtime-api";
import type { LocalSkill, Skill, SkillLocalFiles } from "api-server-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";
import type { PrDisposition } from "../domain/pr-state.js";

export interface PublishSkillCall {
  name: string;
  owner: string;
  repo: string;
  title: string;
  body: string;
  path?: string;
}

export interface PublishSkillResult {
  prUrl: string;
  branch: string;
}

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

export interface AgentRuntimeSkillsClient {
  listLocal(agentId: string, hashNames?: string[]): Promise<LocalSkill[]>;
  publish(agentId: string, body: PublishSkillCall): Promise<PublishSkillResult>;
  scan(agentId: string, source: string, path?: string): Promise<Skill[]>;
  writeLocal(
    agentId: string,
    skills: { name: string; content: string }[],
  ): Promise<LocalSkill[]>;
  deleteLocal(agentId: string, name: string): Promise<void>;
  readLocal(agentId: string, name: string): Promise<SkillLocalFiles>;
  readPullRequest(
    agentId: string,
    coords: { owner: string; repo: string; number: number },
  ): Promise<PrDisposition>;
  readSkillFile(
    agentId: string,
    input: { source: string; version: string; dir: string },
  ): Promise<{ content: string }>;
}

export class AgentRuntimeUpstreamError extends Error {
  constructor(
    message: string,
    public readonly upstream: UpstreamGatewayError,
  ) {
    super(message);
    this.name = "AgentRuntimeUpstreamError";
  }
}

export class AgentRuntimeUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRuntimeUnreachableError";
  }
}

export class AgentRuntimeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRuntimeConflictError";
  }
}

export class AgentRuntimeSourcePathError extends Error {
  constructor(
    label: string,
    readonly reason: SourcePathReason,
    readonly version?: string,
  ) {
    super(`${label}: skill source path ${reason}`);
    this.name = "AgentRuntimeSourcePathError";
  }
}

const PASSTHROUGH_CODES = new Set([
  "NOT_FOUND",
  "PAYLOAD_TOO_LARGE",
  "BAD_REQUEST",
]);

export class AgentRuntimeClientError extends Error {
  constructor(
    label: string,
    public readonly podMessage: string,
    public readonly code: "NOT_FOUND" | "PAYLOAD_TOO_LARGE" | "BAD_REQUEST",
  ) {
    super(`${label}: ${podMessage}`);
    this.name = "AgentRuntimeClientError";
  }
}

function makeClient(agentId: string, namespace: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://${podBaseUrl(agentId, namespace)}/api/trpc`,
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

function isSourcePathReason(value: unknown): value is SourcePathReason {
  return SOURCE_PATH_REASONS.includes(value as SourcePathReason);
}

function readSourcePath(
  value: unknown,
): { reason: SourcePathReason; version?: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const { reason, version } = value as { reason?: unknown; version?: unknown };
  if (!isSourcePathReason(reason)) return null;
  return {
    reason,
    ...(typeof version === "string" && /^[0-9a-f]{7,40}$/.test(version)
      ? { version }
      : {}),
  };
}

async function runWithUpstreamMapping<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TRPCClientError) {
      const data =
        (e.data as {
          upstream?: unknown;
          sourcePath?: unknown;
          code?: unknown;
        } | null) ?? null;
      if (data === null) {
        throw new AgentRuntimeUnreachableError(`${label}: ${e.message}`);
      }
      if (data.code === "CONFLICT") {
        throw new AgentRuntimeConflictError(e.message);
      }
      const sourcePath = readSourcePath(data.sourcePath);
      if (sourcePath) {
        throw new AgentRuntimeSourcePathError(
          label,
          sourcePath.reason,
          sourcePath.version,
        );
      }
      if (typeof data.code === "string" && PASSTHROUGH_CODES.has(data.code)) {
        throw new AgentRuntimeClientError(
          label,
          e.message,
          data.code as AgentRuntimeClientError["code"],
        );
      }
      const upstream = data.upstream;
      if (isUpstreamGatewayError(upstream)) {
        throw new AgentRuntimeUpstreamError(`${label}: ${e.message}`, upstream);
      }
      throw new Error(`${label}: ${e.message}`);
    }
    throw new Error(`${label}: ${(e as Error).message}`);
  }
}

export function createAgentRuntimeSkillsClient(
  namespace: string,
): AgentRuntimeSkillsClient {
  return {
    listLocal: async (agentId, hashNames) => {
      const { skills } = await runWithUpstreamMapping(
        `agent-runtime listLocal ${agentId}`,
        () =>
          makeClient(agentId, namespace).skills.listLocal.query(
            hashNames && hashNames.length > 0 ? { hashNames } : undefined,
          ),
      );
      return skills;
    },
    publish: (agentId, body) =>
      runWithUpstreamMapping(`agent-runtime publish ${agentId}`, () =>
        makeClient(agentId, namespace).skills.publish.mutate(body),
      ),
    scan: async (agentId, source, path) => {
      const { skills } = await runWithUpstreamMapping(
        `agent-runtime scan ${agentId}`,
        () =>
          makeClient(agentId, namespace).skills.scan.mutate({
            source,
            ...(path !== undefined ? { path } : {}),
          }),
      );
      return skills as Skill[];
    },
    writeLocal: async (agentId, skills) => {
      const { skills: created } = await runWithUpstreamMapping(
        `agent-runtime writeLocal ${agentId}`,
        () =>
          makeClient(agentId, namespace).skills.writeLocal.mutate({ skills }),
      );
      return created as LocalSkill[];
    },
    deleteLocal: async (agentId, name) => {
      await runWithUpstreamMapping(`agent-runtime deleteLocal ${agentId}`, () =>
        makeClient(agentId, namespace).skills.deleteLocal.mutate({ name }),
      );
    },
    readLocal: (agentId, name) =>
      runWithUpstreamMapping(`agent-runtime readLocal ${agentId}`, () =>
        makeClient(agentId, namespace).skills.readLocal.query({ name }),
      ),
    readPullRequest: (agentId, coords) =>
      runWithUpstreamMapping(`agent-runtime readPullRequest ${agentId}`, () =>
        makeClient(agentId, namespace).skills.readPullRequest.query(coords),
      ),
    readSkillFile: (agentId, input) =>
      runWithUpstreamMapping(`agent-runtime readSkillFile ${agentId}`, () =>
        makeClient(agentId, namespace).skills.readSkillFile.query(input),
      ),
  };
}
