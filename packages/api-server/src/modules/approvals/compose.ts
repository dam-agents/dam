import type { Db } from "db";
import type { ApprovalsService } from "api-server-api";
import { createApprovalsRepository } from "./infrastructure/approvals-repository.js";
import {
  createApprovalsService,
  type ApprovalsNotifier,
  type EgressRuleWriter,
  type WrapperFrameSender,
} from "./services/approvals-service.js";
import {
  createApprovalsRelayService,
  type ApprovalsRelayService,
} from "./services/approvals-relay-service.js";
import {
  createExtAuthzGate,
  type EgressRuleMatcher,
  type ExtAuthzGate,
  type InstanceIdentityResolver,
} from "./services/ext-authz-gate.js";
import {
  createDeliverySweeper,
  type DeliverySweeper,
} from "./services/delivery-sweeper.js";
import { createRedisApprovalsBus } from "./infrastructure/redis-approvals-bus.js";
import type { RedisBus } from "../../core/redis-bus.js";

/**
 * Per-request, owner-scoped composition for the user-facing tRPC service.
 * The relay/gate are NOT owner-scoped — see `composeApprovalsSystem`.
 */
export interface ComposeApprovalsServiceDeps {
  db: Db;
  ownerSub: string;
  isInstanceOwnedBy(instanceId: string, ownerSub: string): Promise<boolean>;
  egressRuleWriter: EgressRuleWriter;
  bus: RedisBus;
  wrapperFrameSender: WrapperFrameSender;
}

export function composeApprovalsService(
  deps: ComposeApprovalsServiceDeps,
): { service: ApprovalsService } {
  const repo = createApprovalsRepository(deps.db);
  const notifier = createRedisApprovalsBus(deps.bus);
  const service = createApprovalsService({
    repo,
    egressRuleWriter: deps.egressRuleWriter,
    notifier,
    wrapperFrameSender: deps.wrapperFrameSender,
    isInstanceOwnedBy: deps.isInstanceOwnedBy,
    ownerSub: deps.ownerSub,
  });
  return { service };
}

/**
 * Boot-time composition for the server-internal relay/gate/sweeper. These
 * cross all owners and live for the lifetime of the process — bound to the
 * shared bus and the cross-module ports (instance identity, rule matching,
 * wrapper-frame sender).
 */
export interface ComposeApprovalsSystemDeps {
  db: Db;
  bus: RedisBus;
  identityResolver: InstanceIdentityResolver;
  ruleMatcher: EgressRuleMatcher;
  wrapperFrameSender: WrapperFrameSender;
  holdSeconds: number;
  /** Sweep cadence and freshness window for the outbox retry. */
  sweep?: {
    intervalMs?: number;
    staleMs?: number;
    batchSize?: number;
  };
}

export function composeApprovalsSystem(deps: ComposeApprovalsSystemDeps): {
  relay: ApprovalsRelayService;
  gate: ExtAuthzGate;
  sweeper: DeliverySweeper;
} {
  const repo = createApprovalsRepository(deps.db);
  const relay = createApprovalsRelayService({ repo, bus: deps.bus });
  const gate = createExtAuthzGate({
    repo,
    bus: deps.bus,
    identityResolver: deps.identityResolver,
    ruleMatcher: deps.ruleMatcher,
    holdSeconds: deps.holdSeconds,
  });
  const sweeper = createDeliverySweeper({
    repo,
    wrapperFrameSender: deps.wrapperFrameSender,
    intervalMs: deps.sweep?.intervalMs ?? 30_000,
    staleMs: deps.sweep?.staleMs ?? 30_000,
    batchSize: deps.sweep?.batchSize ?? 50,
  });
  return { relay, gate, sweeper };
}

export type { ApprovalsRelayService } from "./services/approvals-relay-service.js";
export type {
  ExtAuthzGate,
  ExtAuthzGateInput,
  ExtAuthzVerdict,
  EgressRuleMatcher,
  InstanceIdentityResolver,
} from "./services/ext-authz-gate.js";
export type { DeliverySweeper } from "./services/delivery-sweeper.js";
export type {
  ApprovalsNotifier,
  EgressRuleWriter,
  WrapperFrameSender,
} from "./services/approvals-service.js";
