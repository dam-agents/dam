import type {
  ConnectionTemplateView,
  ConnectionView,
  KitUpdateChanges,
  KitUpdateStatus,
  StarterKitApplyInput,
  StarterKitApplyToAgentInput,
  StarterKitView,
} from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import {
  classifyTrpcError,
  trpcCall,
  trpcErrorCode,
} from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type { KitRefusedError } from "../domain/errors.js";

type KitResult<T> = Promise<
  Result<T, TransportError | AuthRequiredError | KitRefusedError>
>;

export type KitCreateResult = Awaited<
  ReturnType<TrpcClient["starterKits"]["create"]["mutate"]>
>;

export type KitApplyToAgentResult = Awaited<
  ReturnType<TrpcClient["starterKits"]["applyToAgent"]["mutate"]>
>;

export interface KitService {
  list(): Promise<
    Result<readonly StarterKitView[], TransportError | AuthRequiredError>
  >;
  inspect(url: string): KitResult<StarterKitView>;
  create(input: StarterKitApplyInput): KitResult<KitCreateResult>;
  applyToAgent(
    input: StarterKitApplyToAgentInput,
  ): KitResult<KitApplyToAgentResult>;
  updates(): Promise<
    Result<readonly KitUpdateStatus[], TransportError | AuthRequiredError>
  >;
  changes(agentId: string): KitResult<KitUpdateChanges | null>;
  startUpdate(agentId: string): KitResult<KitUpdateStatus>;
  skipUpdate(agentId: string): KitResult<KitUpdateStatus>;
  connectionTemplates(): Promise<
    Result<
      readonly ConnectionTemplateView[],
      TransportError | AuthRequiredError
    >
  >;
  connections(): Promise<
    Result<readonly ConnectionView[], TransportError | AuthRequiredError>
  >;
  grantedConnectionIds(
    agentId: string,
  ): Promise<Result<readonly string[], TransportError | AuthRequiredError>>;
}

const REFUSALS = new Set([
  "BAD_REQUEST",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "BAD_GATEWAY",
]);

async function refusable<T>(fn: () => Promise<T>): KitResult<T> {
  try {
    return ok(await fn());
  } catch (e) {
    const code = trpcErrorCode(e);
    if (code !== undefined && REFUSALS.has(code))
      return err({
        kind: "kit-refused",
        code,
        reason: e instanceof Error ? e.message : code,
      });
    return classifyTrpcError(e);
  }
}

export function createKitService(deps: { trpc: TrpcClient }): KitService {
  const { starterKits, connections } = deps.trpc;
  return {
    list: () => trpcCall(() => starterKits.list.query()),
    inspect: (url) => refusable(() => starterKits.inspect.query({ url })),
    create: (input) => refusable(() => starterKits.create.mutate(input)),
    applyToAgent: (input) =>
      refusable(() => starterKits.applyToAgent.mutate(input)),
    updates: () => trpcCall(() => starterKits.updates.query()),
    changes: (agentId) =>
      refusable(() => starterKits.updateChanges.query({ agentId })),
    startUpdate: (agentId) =>
      refusable(() => starterKits.startUpdate.mutate({ agentId })),
    skipUpdate: (agentId) =>
      refusable(() => starterKits.skipUpdate.mutate({ agentId })),
    connectionTemplates: () =>
      trpcCall(() => connections.listTemplates.query()),
    connections: () => trpcCall(() => connections.list.query()),
    grantedConnectionIds: (agentId) =>
      trpcCall(async () =>
        (
          await connections.getAgentConnections.query({ agentId })
        ).connections.map((c) => c.connectionId),
      ),
  };
}
