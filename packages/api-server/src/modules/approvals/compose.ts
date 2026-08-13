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
  type EgressAttendance,
  type EgressRuleMatcher,
  type ExtAuthzGate,
  type AgentIdentityResolver,
} from "./services/ext-authz-gate.js";
import {
  createDeliverySweeper,
  type DeliverySweeper,
} from "./services/delivery-sweeper.js";
import { createRedisApprovalsBus } from "./infrastructure/redis-approvals-bus.js";
import type { RedisBus } from "../../core/redis-bus.js";

export interface ComposeApprovalsServiceDeps {
  db: Db;
  ownerSub: string;
  agentBinding: readonly string[] | "*";
  isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
  egressRuleWriter: EgressRuleWriter;
  bus: RedisBus;
  wrapperFrameSender: WrapperFrameSender;
}

export function composeApprovalsService(deps: ComposeApprovalsServiceDeps): {
  service: ApprovalsService;
} {
  const repo = createApprovalsRepository(deps.db);
  const notifier = createRedisApprovalsBus(deps.bus);
  const service = createApprovalsService({
    repo,
    egressRuleWriter: deps.egressRuleWriter,
    notifier,
    wrapperFrameSender: deps.wrapperFrameSender,
    isAgentOwnedBy: deps.isAgentOwnedBy,
    ownerSub: deps.ownerSub,
    agentBinding: deps.agentBinding,
  });
  return { service };
}

export interface ComposeApprovalsSystemDeps {
  db: Db;
  bus: RedisBus;
  identityResolver: AgentIdentityResolver;
  ruleMatcher: EgressRuleMatcher;
  attendance: EgressAttendance;
  wrapperFrameSender: WrapperFrameSender;
  holdSeconds: number;
  platformAllowedHosts: readonly string[];
  sweep?: {
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
    attendance: deps.attendance,
    holdSeconds: deps.holdSeconds,
    platformAllowedHosts: deps.platformAllowedHosts,
  });
  const sweeper = createDeliverySweeper({
    repo,
    wrapperFrameSender: deps.wrapperFrameSender,
    staleMs: deps.sweep?.staleMs ?? 30_000,
    batchSize: deps.sweep?.batchSize ?? 50,
  });
  return { relay, gate, sweeper };
}

export function createApprovalsCleanupHook(
  db: Db,
): (agentId: string) => Promise<void> {
  const repo = createApprovalsRepository(db);
  return (agentId) => repo.deleteForAgent(agentId);
}

export function listPendingApprovalAgentIds(db: Db): Promise<string[]> {
  return createApprovalsRepository(db).listDistinctAgentIds();
}

export type { ApprovalsRelayService } from "./services/approvals-relay-service.js";
export type {
  ExtAuthzGate,
  ExtAuthzGateInput,
  ExtAuthzVerdict,
  EgressAttendance,
  EgressRuleMatcher,
  AgentIdentityResolver,
} from "./services/ext-authz-gate.js";
export type { DeliverySweeper } from "./services/delivery-sweeper.js";
export type {
  ApprovalsNotifier,
  EgressRuleWriter,
  WrapperFrameSender,
} from "./services/approvals-service.js";
