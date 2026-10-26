import type { OutageAlertNotice, SessionCategory } from "api-server-api";
import { match } from "ts-pattern";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  emit,
  EventType,
  type ProviderStatusEvaluated,
} from "../../../events.js";
import {
  grownAgents,
  RECOVERED_SHOWN_DAYS,
  recovers,
  tellable,
  type AffectedAgent,
  type OutageAlert,
  type OutageAlertAffectedBy,
} from "../domain/alert-rules.js";
import type { FailedWork } from "../domain/failed-work.js";
import {
  outageMessage,
  providerNameOf,
  recoveryMessage,
  type AlertNotice,
} from "../domain/messages.js";
import { noticeOf } from "../domain/notices.js";
import type {
  OutageAlertsRepository,
  StoredAlert,
} from "../infrastructure/outage-alerts-repository.js";
import type { FailedWorkStore } from "../infrastructure/redis-failed-work.js";

export interface AgentFacts {
  ownerSub: string;
  name: string;
  disabled: boolean;
}

type EvaluatedOutage = ProviderStatusEvaluated["outages"][number];

export interface OutageAlertsService {
  handle(event: ProviderStatusEvaluated): Promise<void>;
  noticesFor(ownerSub: string, now: Date): Promise<OutageAlertNotice[]>;
}

export function createOutageAlertsService(deps: {
  repo: OutageAlertsRepository;
  notify: (ownerSub: string, notice: AlertNotice) => Promise<{ sent: number }>;
  describeAgent: (agentId: string) => Promise<AgentFacts | null>;
  failedWork: Pick<FailedWorkStore, "since">;
  sessionCategories: (
    agentIds: readonly string[],
    sessionIds: readonly string[],
  ) => Promise<ReadonlyMap<string, SessionCategory>>;
  homeUrl: string;
  delayMs: number;
}): OutageAlertsService {
  const log = () => getLogger();

  const attentionChanged = (alert: OutageAlert) => {
    const [first] = alert.agents;
    if (first)
      emit({
        type: EventType.AttentionChanged,
        ownerSub: alert.ownerSub,
        agentId: first.agentId,
      });
  };

  const send = async (alert: OutageAlert, notice: AlertNotice) => {
    attentionChanged(alert);
    const { sent } = await deps.notify(alert.ownerSub, notice);
    if (sent === 0)
      log().info(
        { ownerSub: alert.ownerSub, templateId: alert.templateId },
        "outage_alerts.nobody_reached",
      );
  };

  const recover = async (stored: StoredAlert, at: Date) => {
    const next: OutageAlert = {
      ...stored.alert,
      state: "recovered",
      recoveredAt: at,
    };
    if (!(await deps.repo.claim(stored.version, next))) return;
    await send(
      next,
      recoveryMessage(next, at, providerNameOf(next.templateId), deps.homeUrl),
    );
  };

  const tell = async (
    ownerSub: string,
    outage: EvaluatedOutage,
    agents: readonly AffectedAgent[],
    at: Date,
  ) => {
    const stored = await deps.repo.read(ownerSub, outage.templateId);
    if (stored?.alert.state === "told") {
      const agentsNow = grownAgents(stored.alert.agents, agents);
      if (!agentsNow) return;
      const grown: OutageAlert = { ...stored.alert, agents: agentsNow };
      if (await deps.repo.claim(stored.version, grown)) attentionChanged(grown);
      return;
    }
    const next: OutageAlert = {
      ownerSub,
      templateId: outage.templateId,
      state: "told",
      reason: outage.reason,
      since: outage.since,
      toldAt: at,
      recoveredAt: null,
      agents,
      statusPageUrl: outage.statusPageUrl,
    };
    if (!(await deps.repo.claim(stored?.version ?? null, next))) return;
    await send(
      next,
      outageMessage(next, providerNameOf(outage.templateId), deps.homeUrl),
    );
  };

  const describe = async (agentId: string) => {
    try {
      const facts = await deps.describeAgent(agentId);
      return facts && !facts.disabled ? facts : null;
    } catch (err) {
      log().warn(
        { agentId, reason: formatError(err) },
        "outage_alerts.agent_unread",
      );
      return null;
    }
  };

  const failedWorkIn = async (outage: EvaluatedOutage) => {
    try {
      return await deps.failedWork.since(outage.templateId, outage.since);
    } catch (err) {
      log().warn(
        { templateId: outage.templateId, reason: formatError(err) },
        "outage_alerts.failed_work_unread",
      );
      return [];
    }
  };

  const categoriesOf = async (work: readonly FailedWork[]) => {
    const sessions = work.flatMap((w) => (w.kind === "session" ? [w] : []));
    if (sessions.length === 0) return new Map<string, SessionCategory>();
    try {
      return await deps.sessionCategories(
        [...new Set(sessions.map((w) => w.agentId))],
        [...new Set(sessions.map((w) => w.sessionId))],
      );
    } catch (err) {
      log().warn({ reason: formatError(err) }, "outage_alerts.sessions_unread");
      return new Map<string, SessionCategory>();
    }
  };

  const affectedOwners = async (outage: EvaluatedOutage) => {
    const work = await failedWorkIn(outage);
    const categories = await categoriesOf(work);
    const reasons = new Map<string, OutageAlertAffectedBy[]>();
    for (const failed of work) {
      const reason = match(failed)
        .with({ kind: "session" }, ({ sessionId }) =>
          categories.get(sessionId) === "scheduled" ? "schedule" : null,
        )
        .with({ kind: "ambient" }, ({ channel }) => channel)
        .exhaustive();
      const known = reasons.get(failed.agentId) ?? [];
      if (reason && !known.includes(reason))
        reasons.set(failed.agentId, [...known, reason]);
    }
    const owners = new Map<string, AffectedAgent[]>();
    for (const [agentId, affectedBy] of reasons) {
      const facts = await describe(agentId);
      if (!facts) continue;
      owners.set(facts.ownerSub, [
        ...(owners.get(facts.ownerSub) ?? []),
        { agentId, name: facts.name, affectedBy },
      ]);
    }
    for (const agents of owners.values())
      agents.sort((a, b) => a.name.localeCompare(b.name));
    return owners;
  };

  const settle = async (
    ownerSub: string,
    templateId: string,
    work: () => Promise<void>,
  ) => {
    try {
      await work();
    } catch (err) {
      log().warn(
        { ownerSub, templateId, reason: formatError(err) },
        "outage_alerts.failed",
      );
    }
  };

  return {
    async handle(event) {
      for (const stored of await deps.repo.listTold())
        if (recovers(stored.alert, event))
          await settle(stored.alert.ownerSub, stored.alert.templateId, () =>
            recover(stored, event.checkedAt),
          );
      for (const outage of event.outages) {
        if (
          !tellable(
            outage,
            event.damSide !== null,
            event.checkedAt,
            deps.delayMs,
          )
        )
          continue;
        for (const [ownerSub, agents] of await affectedOwners(outage))
          await settle(ownerSub, outage.templateId, () =>
            tell(ownerSub, outage, agents, event.checkedAt),
          );
      }
    },

    async noticesFor(ownerSub, now) {
      const recoveredSince = new Date(
        now.getTime() - RECOVERED_SHOWN_DAYS * 24 * 60 * 60 * 1000,
      );
      return (await deps.repo.listForOwner(ownerSub, recoveredSince)).map(
        noticeOf,
      );
    },
  };
}
