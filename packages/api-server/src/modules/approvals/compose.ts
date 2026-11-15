import {
  createChildEgressRequests,
  type ChildEgressRequests,
} from "./services/child-egress-requests.js";
import {
  createChildEgressRelease,
  type ChildEgressRelease,
} from "./services/child-egress-release.js";
import type { Db } from "db";
import type {
  ApprovalsService,
  SpendLimitPayload,
  ToolApprovalReports,
} from "api-server-api";
import {
  createApprovalsRepository,
  deletePendingSpendQuestions,
} from "./infrastructure/approvals-repository.js";
import { emit, EventType } from "../../events.js";
import {
  createApprovalsService,
  type ChildEgressAnswered,
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
  type ProviderScopes,
  type ExtAuthzDecision,
  type ExtAuthzGate,
  type AgentIdentityResolver,
  type WaitingRuleSpeaksFor,
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
export { startChildEgressAnsweredSaga } from "./sagas/child-egress-answered.js";
import { createToolApprovalReports } from "./services/tool-approval-reports.js";
import {
  createEgressProposals,
  type EgressProposals,
} from "./services/egress-proposals.js";
import type { Subscription } from "rxjs";
import type { RedisBus } from "../../core/redis-bus.js";

interface ComposeApprovalsServiceDeps {
  db: Db;
  ownerSub: string;
  actor: string;
  actorEmail: string | null;
  agentBinding: readonly string[] | "*";
  isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
  egressRuleWriter: EgressRuleWriter;
  wrapperFrameSender: WrapperFrameSender;
  childEgressSwitch?: {
    turnOnForRootOf(driverId: string, decidedBy: string): Promise<void>;
  };
  childEgressAnswered?: ChildEgressAnswered;
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
    actor: deps.actor,
    actorEmail: deps.actorEmail,
    agentBinding: deps.agentBinding,
    childEgressSwitch: deps.childEgressSwitch,
    childEgressAnswered: deps.childEgressAnswered,
  });
  return { service };
}

interface ComposeApprovalsSystemDeps {
  db: Db;
  bus: RedisBus;
  identityResolver: AgentIdentityResolver;
  ruleMatcher: EgressRuleMatcher;
  providerScopes: ProviderScopes;
  attendance: EgressAttendance;
  spend: SpendCheck;
  wrapperFrameSender: WrapperFrameSender;
  holdSeconds: number;
  platformAllowedAuthorities: readonly string[];
  waitingRuleSpeaksFor: WaitingRuleSpeaksFor;
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
    providerScopes: deps.providerScopes,
    attendance: deps.attendance,
    spend: deps.spend,
    questions: createSpendLimitQuestions({ repo }),
    holdSeconds: deps.holdSeconds,
    platformAllowedAuthorities: deps.platformAllowedAuthorities,
    waitingRuleSpeaksFor: deps.waitingRuleSpeaksFor,
  });
  const sweeper = createDeliverySweeper({
    repo,
    wrapperFrameSender: deps.wrapperFrameSender,
    staleMs: 30_000,
    batchSize: 50,
  });
  return { relay, gate, sweeper, wakeSaga };
}

export function composeToolApprovalReports(
  relay: ApprovalsRelayService,
  ownerSub: string,
): ToolApprovalReports {
  return createToolApprovalReports({ relay, ownerSub });
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

export function composeEgressProposals(deps: {
  db: Db;
  ruleMatcher: EgressRuleMatcher;
  agentId: string;
  ownerSub: string;
}): EgressProposals {
  return createEgressProposals({
    repo: createApprovalsRepository(deps.db),
    ruleMatcher: deps.ruleMatcher,
    agentId: deps.agentId,
    ownerSub: deps.ownerSub,
  });
}

export function composeChildEgressRelease(deps: {
  db: Db;
  writer: EgressRuleWriter;
  rootOf: (agentId: string) => Promise<string | null>;
  answered?: ChildEgressAnswered;
}): ChildEgressRelease {
  return createChildEgressRelease({
    repo: createApprovalsRepository(deps.db),
    writer: deps.writer,
    rootOf: deps.rootOf,
    ...(deps.answered && { answered: deps.answered }),
  });
}

// UNIT_BOUNDARY_DESCRIPTION: the requests a child's rules wait on with its owner, each with its host and request id, for a launch or an update to name them to the driver.
export function childEgressWaiting(
  db: Db,
): (childId: string) => Promise<{ host: string; id: string }[]> {
  const repo = createApprovalsRepository(db);
  return async (childId) =>
    (await repo.listPendingChildEgressRequests(childId)).flatMap((row) =>
      row.payload.kind === "egress_proposal"
        ? [{ host: row.payload.host, id: row.id }]
        : [],
    );
}

// UNIT_BOUNDARY_DESCRIPTION: which of the agents named have a rule their driver set that waits for the owner.
export function childEgressWaitingAmong(
  db: Db,
): (agentIds: readonly string[]) => Promise<Set<string>> {
  const repo = createApprovalsRepository(db);
  return async (agentIds) =>
    new Set(await repo.listAgentsWithPendingChildEgressRequests(agentIds));
}

export function composeChildEgressRequests(deps: {
  db: Db;
  ownerOf: (agentId: string) => Promise<string | null>;
  nameOf: (agentId: string) => Promise<string | null>;
  isEnvironment: (agentId: string) => Promise<boolean>;
}): ChildEgressRequests {
  return createChildEgressRequests({
    repo: createApprovalsRepository(deps.db),
    ownerOf: deps.ownerOf,
    nameOf: deps.nameOf,
    isEnvironment: deps.isEnvironment,
  });
}

export function listPendingApprovalAgentIds(db: Db): Promise<string[]> {
  return createApprovalsRepository(db).listDistinctAgentIds();
}

export type {
  ChildEgressRequests,
  EgressProposals,
  ApprovalsRelayService,
  ExtAuthzDecision,
  ExtAuthzGate,
  SpendLimitQuestions,
  WrapperFrameSender,
};
