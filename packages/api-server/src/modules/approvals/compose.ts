import type { Db } from "db";
import type { ApprovalsService, SpendLimitPayload } from "api-server-api";
import {
  createApprovalsRepository,
  deletePendingSpendQuestions,
} from "./infrastructure/approvals-repository.js";
import { emit, EventType } from "../../events.js";
import {
  createApprovalsService,
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
  type ExtAuthzDecision,
  type ExtAuthzGate,
  type AgentIdentityResolver,
} from "./services/ext-authz-gate.js";
import {
  createSpendLimitQuestions,
  type SpendLimitQuestions,
} from "./services/spend-limit-questions.js";
import type { SpendCheck } from "../spend/index.js";
import {
  createDeliverySweeper,
  type DeliverySweeper,
} from "./services/delivery-sweeper.js";
import { startWakeHeldCallsSaga } from "./sagas/wake-held-calls.js";
import type { Subscription } from "rxjs";
import type { RedisBus } from "../../core/redis-bus.js";

interface ComposeApprovalsServiceDeps {
  db: Db;
  ownerSub: string;
  agentBinding: readonly string[] | "*";
  isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
  egressRuleWriter: EgressRuleWriter;
  wrapperFrameSender: WrapperFrameSender;
}

export function composeApprovalsService(deps: ComposeApprovalsServiceDeps): {
  service: ApprovalsService;
} {
  const repo = createApprovalsRepository(deps.db);
  const service = createApprovalsService({
    repo,
    egressRuleWriter: deps.egressRuleWriter,
    wrapperFrameSender: deps.wrapperFrameSender,
    isAgentOwnedBy: deps.isAgentOwnedBy,
    ownerSub: deps.ownerSub,
    agentBinding: deps.agentBinding,
  });
  return { service };
}

interface ComposeApprovalsSystemDeps {
  db: Db;
  bus: RedisBus;
  identityResolver: AgentIdentityResolver;
  ruleMatcher: EgressRuleMatcher;
  attendance: EgressAttendance;
  spend: SpendCheck;
  wrapperFrameSender: WrapperFrameSender;
  holdSeconds: number;
  platformAllowedAuthorities: readonly string[];
}

export function composeApprovalsSystem(deps: ComposeApprovalsSystemDeps): {
  relay: ApprovalsRelayService;
  gate: ExtAuthzGate;
  sweeper: DeliverySweeper;
  wakeSaga: Subscription;
} {
  const repo = createApprovalsRepository(deps.db);
  const wakeSaga = startWakeHeldCallsSaga(deps.bus);
  const relay = createApprovalsRelayService({ repo, bus: deps.bus });
  const gate = createExtAuthzGate({
    repo,
    bus: deps.bus,
    identityResolver: deps.identityResolver,
    ruleMatcher: deps.ruleMatcher,
    attendance: deps.attendance,
    spend: deps.spend,
    questions: createSpendLimitQuestions({ repo }),
    holdSeconds: deps.holdSeconds,
    platformAllowedAuthorities: deps.platformAllowedAuthorities,
  });
  const sweeper = createDeliverySweeper({
    repo,
    wrapperFrameSender: deps.wrapperFrameSender,
    staleMs: 30_000,
    batchSize: 50,
  });
  return { relay, gate, sweeper, wakeSaga };
}

export function createApprovalsCleanupHook(
  db: Db,
): (agentId: string) => Promise<void> {
  const repo = createApprovalsRepository(db);
  return (agentId) => repo.deleteForAgent(agentId);
}

export function composeSpendLimitQuestions(db: Db): SpendLimitQuestions {
  return createSpendLimitQuestions({ repo: createApprovalsRepository(db) });
}

export function createSpendQuestionStore(db: Db): {
  read(approvalId: string): Promise<SpendLimitPayload | null>;
  closePending(input: { ownerSub: string; limitId: string }): Promise<void>;
} {
  const repo = createApprovalsRepository(db);
  return {
    async read(approvalId) {
      const row = await repo.getPending(approvalId);
      return row?.payload.kind === "spend_limit" ? row.payload : null;
    },
    async closePending({ ownerSub, limitId }) {
      const closed = await deletePendingSpendQuestions(db, ownerSub, limitId);
      for (const { id, agentId } of closed) {
        emit({
          type: EventType.ApprovalResolved,
          approvalId: id,
          agentId,
          ownerSub,
          resolution: "superseded",
        });
      }
    },
  };
}

export function listPendingApprovalAgentIds(db: Db): Promise<string[]> {
  return createApprovalsRepository(db).listDistinctAgentIds();
}

export type {
  ApprovalsRelayService,
  ExtAuthzDecision,
  ExtAuthzGate,
  SpendLimitQuestions,
  WrapperFrameSender,
};
