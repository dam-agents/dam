import { createTRPCClient, httpLink } from "@trpc/client";
import type {
  AppRouter,
  KbPublishExecuteInput,
  KbPublishExecuteReport,
  KbPublishPlan,
  KbPublishPlanInput,
  Result,
} from "agent-runtime-api";
import type { KbPublishFailure } from "agent-runtime-api/kb-snapshot";

import { podBaseUrl } from "../../agents/infrastructure/k8s.js";

const PLAN_TIMEOUT_MS = 120_000;
const EXECUTE_TIMEOUT_MS = 280_000;

export class KbPublishUnreachableError extends Error {
  constructor(agentId: string, cause: string) {
    super(`agent ${agentId} kb-publish api unreachable: ${cause}`);
    this.name = "KbPublishUnreachableError";
  }
}

export interface KbPublishClient {
  plan(
    agentId: string,
    input: KbPublishPlanInput,
  ): Promise<Result<KbPublishPlan, KbPublishFailure>>;
  execute(
    agentId: string,
    input: KbPublishExecuteInput,
  ): Promise<Result<KbPublishExecuteReport, KbPublishFailure>>;
}

function makeClient(agentId: string, namespace: string, timeoutMs: number) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `http://${podBaseUrl(agentId, namespace)}/api/trpc`,
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
      }),
    ],
  });
}

export function createKbPublishClient(namespace: string): KbPublishClient {
  async function call<T>(
    agentId: string,
    timeoutMs: number,
    run: (client: ReturnType<typeof makeClient>) => Promise<T>,
  ): Promise<T> {
    try {
      return await run(makeClient(agentId, namespace, timeoutMs));
    } catch (err) {
      throw new KbPublishUnreachableError(
        agentId,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return {
    plan: (agentId, input) =>
      call(agentId, PLAN_TIMEOUT_MS, (c) => c.kbPublish.plan.mutate(input)),
    execute: (agentId, input) =>
      call(agentId, EXECUTE_TIMEOUT_MS, (c) =>
        c.kbPublish.execute.mutate(input),
      ),
  };
}
