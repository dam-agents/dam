import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import type { LocalSkill, Skill } from "api-server-api";
import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

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

/**
 * Upstream-error envelope agent-runtime emits via its tRPC `errorFormatter`
 * when an upstream gateway returns a structured error
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

export interface AgentRuntimeSkillsClient {
  listLocal(agentId: string): Promise<LocalSkill[]>;
  publish(agentId: string, body: PublishSkillCall): Promise<PublishSkillResult>;
  scan(agentId: string, source: string, path?: string): Promise<Skill[]>;
  writeLocal(
    agentId: string,
    skills: { name: string; content: string }[],
  ): Promise<LocalSkill[]>;
  deleteLocal(agentId: string, name: string): Promise<void>;
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

/** The api-server → pod hop itself failed: no tRPC response ever arrived
 *  (pod restarting, mesh outage). Distinct from errors the pod *returned* —
 *  a transport failure inside the pod (e.g. GitHub egress blocked) comes
 *  back as a structured `upstream_unreachable` envelope, never as this. */
export class AgentRuntimeUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRuntimeUnreachableError";
  }
}

/** The pod returned a tRPC CONFLICT — a writeLocal collision. Carries the
 *  pod's message verbatim (`skill(s) already exist: <names>`, per the
 *  agent-runtime contract) so the api-server can pass it through and the UI
 *  can parse the offending names back out. */
export class AgentRuntimeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRuntimeConflictError";
  }
}

// Auth on the api-server → agent-runtime hop is enforced at the kernel by
// the agent pod's NetworkPolicy (ingress admitted only from the api-server
// pod). No Bearer header is sent.
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

/**
 * Run a tRPC call and translate `data.upstream` (set by agent-runtime's
 * errorFormatter for upstream gateway errors) into an
 * AgentRuntimeUpstreamError so callers can extract the CTA URL. A response
 * with no `data` at all means the pod never answered — the error envelope is
 * built server-side, so its absence is a transport failure on this hop, not
 * something the pod threw. Other tRPC errors propagate as plain Error.
 */
async function runWithUpstreamMapping<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TRPCClientError) {
      const data =
        (e.data as { upstream?: unknown; code?: unknown } | null) ?? null;
      if (data === null) {
        throw new AgentRuntimeUnreachableError(`${label}: ${e.message}`);
      }
      // A pod-side CONFLICT (writeLocal collision) has no `.upstream` envelope
      // and would otherwise flatten to a plain Error, losing the code. Preserve
      // it with the message verbatim so the UI can mark the offending rows.
      if (data.code === "CONFLICT") {
        throw new AgentRuntimeConflictError(e.message);
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
    listLocal: async (agentId) => {
      const { skills } = await runWithUpstreamMapping(
        `agent-runtime listLocal ${agentId}`,
        () => makeClient(agentId, namespace).skills.listLocal.query(),
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
  };
}
