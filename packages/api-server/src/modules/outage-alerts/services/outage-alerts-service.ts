import type { OutageAlertNotice } from "api-server-api";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  emit,
  EventType,
  type ProviderStatusEvaluated,
} from "../../../events.js";
import {
  RECOVERED_SHOWN_DAYS,
  recovers,
  tellable,
  type AffectedAgent,
  type OutageAlert,
  type OutageAlertAffectedBy,
} from "../domain/alert-rules.js";
import {
  outageMessage,
  providerNameOf,
  recoveryMessage,
} from "../domain/messages.js";
import { noticeOf } from "../domain/notices.js";
import type {
  OutageAlertsRepository,
  StoredAlert,
} from "../infrastructure/outage-alerts-repository.js";
import type { UnattendedAgentOn } from "./unattended-agents.js";

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
  notify: (ownerSub: string, text: string) => Promise<{ sent: number }>;
  describeAgent: (agentId: string) => Promise<AgentFacts | null>;
  unattendedAgentsOn: (templateId: string) => Promise<UnattendedAgentOn[]>;
  homeUrl: string;
  brandName: string;
  delayMs: number;
}): OutageAlertsService {
  const log = () => getLogger();
  const providerName = (templateId: string) =>
    providerNameOf(templateId, deps.brandName);

  const send = async (alert: OutageAlert, text: string) => {
    const [first] = alert.agents;
    if (first)
      emit({
        type: EventType.AttentionChanged,
        ownerSub: alert.ownerSub,
        agentId: first.agentId,
      });
    const { sent } = await deps.notify(alert.ownerSub, text);
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
      recoveryMessage(next, at, providerName(next.templateId), deps.homeUrl),
    );
  };

  const tell = async (
    ownerSub: string,
    outage: EvaluatedOutage,
    agents: readonly AffectedAgent[],
    at: Date,
  ) => {
    const stored = await deps.repo.read(ownerSub, outage.templateId);
    if (stored?.alert.state === "told") return;
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
      outageMessage(next, providerName(outage.templateId), deps.homeUrl),
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

  const unattendedOn = async (templateId: string) => {
    try {
      return await deps.unattendedAgentsOn(templateId);
    } catch (err) {
      log().warn(
        { templateId, reason: formatError(err) },
        "outage_alerts.unattended_unread",
      );
      return [];
    }
  };

  const affectedOwners = async (outage: EvaluatedOutage) => {
    const reasons = new Map<string, OutageAlertAffectedBy[]>();
    const add = (agentId: string, affectedBy: OutageAlertAffectedBy[]) =>
      reasons.set(agentId, [...(reasons.get(agentId) ?? []), ...affectedBy]);
    for (const agentId of outage.failedPayers) add(agentId, ["failed-calls"]);
    for (const agent of await unattendedOn(outage.templateId))
      add(agent.agentId, agent.affectedBy);
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
