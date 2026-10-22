import { TRPCError } from "@trpc/server";
import {
  connectionLimitRefusal,
  connectionLimitRule,
  nextUtcMidnight,
  SPEND_SESSIONS_DEFAULT_LIMIT,
  type SessionCategory,
  type SpendCeilingView,
  type SpendLimitScope,
  type SpendLimitView,
  type SpendService,
  type SpendTotal,
} from "api-server-api";
import { match } from "ts-pattern";
import { emit, EventType } from "../../../events.js";
import {
  agentIdsOf,
  agentNames,
  foldBreakdown,
  labelAgents,
  labelCallingAgents,
  topSubAgents,
  type AgentLabels,
  type BreakdownRow,
} from "../domain/breakdown.js";
import { bindingOf } from "../domain/binding.js";
import { utcDay } from "../domain/ledger.js";
import {
  ceilingCounter,
  limitCounter,
  readCeiling,
  readLimit,
  type SpendCeiling,
  type SpendLimit,
} from "../domain/limits.js";
import { meteringNoticeEnd, meteringView } from "../domain/metering.js";
import { foldTurns } from "../domain/turns.js";
import type { SpendUnit } from "../domain/units.js";
import type { SpendLedger } from "../infrastructure/spend-ledger.js";
import type { SpendLimits } from "../infrastructure/spend-limits.js";
import type { SpendCeilings } from "../infrastructure/user-spend-ceilings.js";
import { readSessionSpend, type SpawnedSubAgents } from "./session-spend.js";
import type { DayTotals, GrantedConnections } from "./spend-check.js";

export interface SpendQuestionCloser {
  closePending(input: { ownerSub: string; limitId: string }): Promise<void>;
}

export interface AgentPayers {
  payerOf(agentId: string): Promise<string>;
}

export interface ConnectionNames {
  namesOf(ownerSub: string): Promise<ReadonlyMap<string, string>>;
}

export interface AgentNames {
  namesOf(ownerSub: string): Promise<ReadonlyMap<string, string>>;
}

export interface InvocationTasks {
  tasksOf(
    ownerSub: string,
    agentIds: readonly string[],
  ): Promise<ReadonlyMap<string, { name: string; task: string }>>;
}

export interface OwnedAgentAges {
  anyCreatedBefore(ownerSub: string, at: Date): Promise<boolean>;
}

export interface SessionCategories {
  categorize(
    agentIds: readonly string[],
    sessionIds: readonly string[],
  ): Promise<ReadonlyMap<string, SessionCategory>>;
}

export function createSpendService(deps: {
  ledger: SpendLedger;
  limits: SpendLimits;
  ceilings: SpendCeilings;
  totals: DayTotals;
  connections: GrantedConnections;
  questions: SpendQuestionCloser;
  payers: AgentPayers;
  sessions: SessionCategories;
  subAgents: SpawnedSubAgents;
  meteringStart(): Promise<Date>;
  isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
  connectionNames(): Promise<ReadonlyMap<string, string>>;
  liveAgentNames(): Promise<ReadonlyMap<string, string>>;
  lastKnownNames(
    agentIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  invocationTasks(
    agentIds: readonly string[],
  ): Promise<ReadonlyMap<string, { name: string; task: string }>>;
  ownedAgentCreatedBefore(at: Date): Promise<boolean>;
  telemetryStoreOn: boolean;
  ownerSub: string;
  agentBinding: readonly string[] | "*";
}): SpendService {
  const requireOwned = async (agentId: string) => {
    if (!(await deps.isAgentOwnedBy(agentId, deps.ownerSub))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
    }
  };

  const requirePayer = async (agentId: string) => {
    const payer = await deps.payers.payerOf(agentId);
    if (payer !== agentId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `this agent is a sub-agent of ${payer}: its spend counts toward the spend limits of that agent, so it has no limits of its own`,
      });
    }
  };

  const limitView = async (
    limit: SpendLimit,
    day: string,
  ): Promise<SpendLimitView> => {
    const reading = readLimit(
      limit,
      await deps.totals.spentToday(limitCounter(limit, day)),
    );
    return {
      id: limit.id,
      scope: limit.scope,
      unit: limit.unit,
      amountMicros: limit.amountMicros,
      extensions: limit.extensions,
      effectiveMicros: reading.effectiveMicros,
      spentMicros: reading.spentMicros,
      leftMicros: reading.leftMicros,
      state: reading.state,
    };
  };

  const ceilingView = async (
    ceiling: SpendCeiling,
    day: string,
  ): Promise<SpendCeilingView> => {
    const reading = readCeiling(
      ceiling,
      await deps.totals.spentToday(ceilingCounter(deps.ownerSub, day)),
    );
    return {
      amountMicros: ceiling.amountMicros,
      spentMicros: reading.spentMicros,
      state: reading.state,
      source: ceiling.source,
    };
  };

  const connectionUnit = (
    template: string | null,
    notFound: string,
  ): SpendUnit => {
    if (template === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: notFound });
    }
    const rule = connectionLimitRule(template);
    if (!rule.limitable) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: connectionLimitRefusal(rule),
      });
    }
    return rule.unit;
  };

  const limitUnit = (scope: SpendLimitScope): Promise<SpendUnit> =>
    match(scope)
      .with({ kind: "agent" }, { kind: "owner" }, () =>
        Promise.resolve<SpendUnit>("usd"),
      )
      .with({ kind: "connection" }, async ({ agentId, connectionId }) =>
        connectionUnit(
          await deps.connections.templateOf(agentId, connectionId),
          "the Connection is not granted to this agent",
        ),
      )
      .with({ kind: "owner-connection" }, async ({ connectionId }) =>
        connectionUnit(
          await deps.connections.ownedTemplateOf(deps.ownerSub, connectionId),
          "the Connection is not yours",
        ),
      )
      .exhaustive();

  const scopedAgents = (agentId: string | undefined) =>
    agentId ? [agentId] : deps.agentBinding === "*" ? null : deps.agentBinding;

  const categoriesOf = async (rows: readonly BreakdownRow[]) => {
    const withSession = rows.filter((row) => row.sessionId);
    if (withSession.length === 0) return new Map<string, SessionCategory>();
    return deps.sessions.categorize(
      [...new Set(withSession.map((row) => row.callingAgentId || row.payer))],
      [...new Set(withSession.map((row) => row.sessionId))],
    );
  };

  const labelsOf = async (
    agentIds: readonly string[],
    callingAgentIds: readonly string[],
  ): Promise<AgentLabels> => {
    const [liveNames, invocationTasks, lastKnownNames] = await Promise.all([
      deps.liveAgentNames(),
      deps.invocationTasks(callingAgentIds),
      deps.lastKnownNames(agentIds),
    ]);
    const tasks = [...invocationTasks];
    return {
      names: agentNames({
        subAgentNames: new Map(
          tasks.flatMap(([id, { name }]) =>
            name ? [[id, name] as const] : [],
          ),
        ),
        liveNames,
        lastKnownNames,
      }),
      tasks: new Map(tasks.map(([id, { task }]) => [id, task])),
    };
  };

  return {
    async daily({ agentId, from, to }) {
      return deps.ledger.daily({
        ownerSub: deps.ownerSub,
        agentIds: scopedAgents(agentId),
        from,
        to,
      });
    },

    async breakdown({ agentId, from, to }) {
      const payer = agentId ? await deps.payers.payerOf(agentId) : undefined;
      const scope = !agentId ? "owner" : payer === agentId ? "payer" : "caller";
      const [rows, connectionNames] = await Promise.all([
        deps.ledger.breakdownRows({
          ownerSub: deps.ownerSub,
          agentIds: scopedAgents(payer),
          ...(scope === "caller" && { callingAgentId: agentId }),
          from,
          to,
        }),
        deps.connectionNames(),
      ]);
      const breakdown = foldBreakdown({
        from,
        to,
        rows,
        connectionNames,
        sessionCategories: await categoriesOf(rows),
        scope,
      });
      return labelAgents(
        breakdown,
        await labelsOf(
          agentIdsOf([...breakdown.byAgent, ...breakdown.byCallingAgent]),
          agentIdsOf(breakdown.byCallingAgent),
        ),
      );
    },

    async subAgents({ agentId, from, to, limit }) {
      if ((await deps.payers.payerOf(agentId)) !== agentId) {
        return { count: 0, rows: [] };
      }
      const top = topSubAgents(
        await deps.ledger.breakdownRows({
          ownerSub: deps.ownerSub,
          agentIds: scopedAgents(agentId),
          from,
          to,
        }),
        limit,
      );
      const agentIds = agentIdsOf(top.rows);
      return {
        count: top.count,
        rows: labelCallingAgents(top.rows, await labelsOf(agentIds, agentIds)),
      };
    },

    async sessions({ agentId, from, to, sessionIds, limit }) {
      return readSessionSpend(deps, {
        ownerSub: deps.ownerSub,
        agentId,
        from: from ?? utcDay(await deps.meteringStart()),
        to: to ?? utcDay(new Date()),
        ...(sessionIds && { sessionIds }),
        limit: limit ?? SPEND_SESSIONS_DEFAULT_LIMIT,
      });
    },

    async turns({ agentId, sessionId, windows }) {
      const rows = await deps.ledger.turnWindows({
        ownerSub: deps.ownerSub,
        callingAgentId: agentId,
        ...(sessionId && { sessionId }),
        windows,
      });
      return foldTurns(windows, rows);
    },

    async metering() {
      const now = new Date();
      const startedAt = await deps.meteringStart();
      const noticeOpen = now < meteringNoticeEnd(startedAt);
      return meteringView({
        startedAt,
        now,
        ownsAgentFromBeforeStart:
          noticeOpen && (await deps.ownedAgentCreatedBefore(startedAt)),
        telemetryStoreOn: deps.telemetryStoreOn,
      });
    },

    async status(input) {
      const now = new Date();
      const day = utcDay(now);
      const agentId = input?.agentId;
      if (agentId) await requireOwned(agentId);
      const [limits, ceiling, rows, byConnection, ownerByConnection, granted] =
        await Promise.all([
          deps.limits.applying(
            { agentId: agentId ?? null, ownerSub: deps.ownerSub },
            day,
          ),
          deps.ceilings.forOwner(deps.ownerSub),
          deps.ledger.daily({
            ownerSub: deps.ownerSub,
            agentIds: scopedAgents(agentId),
            from: day,
            to: day,
          }),
          agentId
            ? deps.ledger.byConnection({
                ownerSub: deps.ownerSub,
                agentId,
                day,
              })
            : [],
          deps.ledger.byConnection({
            ownerSub: deps.ownerSub,
            agentId: null,
            day,
          }),
          agentId ? deps.connections.grantedTo(agentId) : [],
        ]);
      const spent = new Map<string, SpendTotal>();
      for (const row of rows) {
        const total = spent.get(row.unit) ?? {
          unit: row.unit,
          costMicros: 0,
          estimatedCalls: 0,
        };
        total.costMicros += row.costMicros;
        total.estimatedCalls += row.estimatedCalls;
        spent.set(row.unit, total);
      }
      const limitViews = await Promise.all(
        limits.map((limit) => limitView(limit, day)),
      );
      const ceilingReading = ceiling ? await ceilingView(ceiling, day) : null;
      const names = agentId
        ? await deps.connectionNames()
        : new Map<string, string>();
      return {
        day,
        resetsAt: nextUtcMidnight(now).toISOString(),
        limits: limitViews,
        ceiling: ceilingReading,
        spent: [...spent.values()],
        spentByConnection: byConnection,
        ownerSpentByConnection: ownerByConnection,
        binding: agentId
          ? bindingOf({
              agentId,
              limits: limitViews,
              ceiling: ceilingReading,
              connections: granted.flatMap(({ connectionId, templateId }) => {
                const rule = connectionLimitRule(templateId);
                return rule.limitable
                  ? [
                      {
                        connectionId,
                        name: names.get(connectionId) ?? connectionId,
                        unit: rule.unit,
                      },
                    ]
                  : [];
              }),
            })
          : [],
      };
    },

    async setLimit({ scope, amountMicros }) {
      if (scope.kind === "agent" || scope.kind === "connection") {
        await requireOwned(scope.agentId);
        if (amountMicros !== null) await requirePayer(scope.agentId);
      }
      const limitId =
        amountMicros === null
          ? await deps.limits.clear(deps.ownerSub, scope)
          : await deps.limits.set({
              ownerSub: deps.ownerSub,
              scope,
              unit: await limitUnit(scope),
              amountMicros,
            });
      if (limitId !== null) {
        await deps.questions.closePending({ ownerSub: deps.ownerSub, limitId });
      }
      emit({ type: EventType.SpendLimitsChanged, ownerSub: deps.ownerSub });
    },
  };
}
