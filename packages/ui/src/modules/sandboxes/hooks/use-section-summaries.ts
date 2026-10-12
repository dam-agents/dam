import {
  type EgressPreset,
  isProtectedAgentEnvName,
  providerTypeForTemplateId,
  SHARED_KB_TEMPLATE_ID,
} from "api-server-api";
import { useMemo } from "react";

import type { AgentView } from "../../../types.js";
import {
  useHarnessConfigStatus,
  useResolvedHarnessConfig,
  useStaleModel,
} from "../../agents/api/harness-config.js";
import { useAgentConnections, useAgents } from "../../agents/api/queries.js";
import {
  useSkillSourceCount,
  useSkillsState,
} from "../../agents/api/skills.js";
import { useBudgetReserved } from "../../budgets/api/queries.js";
import {
  formatSizeLabel,
  sizeInMi,
  slotUnitOf,
} from "../../budgets/lib/slots.js";
import {
  useAppConnections,
  useConnectionTemplates,
} from "../../connections/api/queries.js";
import { catalogProviderTitle } from "../../connections/lib/catalog-providers.js";
import { useCurrentPreset } from "../../egress-rules/api/queries.js";
import { useAgentMonthSpend } from "../../metrics/api/queries.js";
import { formatUsdCents } from "../../metrics/lib/format.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { NO_SATELLITES, useSatellites } from "../../satellites/api/queries.js";
import { useSchedules } from "../../schedules/api/queries.js";
import { isUpcoming } from "../../schedules/lib/once-schedule.js";
import { useTelegramChats } from "../../telegram/api/queries.js";

type SectionSummaries = Partial<Record<SandboxSection, string>>;
type SectionWarnings = Partial<Record<SandboxSection, string>>;

const STALE_MODEL_WARNING = "Saved model not offered by the current provider";
const NO_PROVIDER_WARNING =
  "No provider connected — the agent cannot reach a model";
const NO_PROVIDER_CHAT_WARNING =
  "No model provider granted — the agent cannot reach a model. Pick one when you start a session in chat.";

const PRESET_SUMMARY: Record<EgressPreset, string> = {
  trusted: "Trusted defaults",
  none: "Default-deny",
  all: "Allow everything",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatNameList(names: string[], max = 2): string | undefined {
  if (names.length === 0) return undefined;
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return extra > 0 ? `${shown.join(", ")}, +${extra} more` : shown.join(", ");
}

export function useSectionSummaries(agent: AgentView | null): {
  summaries: SectionSummaries;
  warnings: SectionWarnings;
} {
  const { data: apps = [], isSuccess: appsLoaded } = useAppConnections();
  const connectionsQuery = useAgentConnections(agent?.id ?? null);
  const { data: satellites = NO_SATELLITES } = useSatellites();
  const agentId = agent?.id;
  const { data: schedules = [] } = useSchedules(agent?.id ?? null);
  const skillsState = useSkillsState(agent?.id ?? null);
  const { data: configStatus } = useHarnessConfigStatus(agent?.id ?? null);

  const providerAppIds = useMemo(
    () =>
      new Set(
        apps
          .filter((a) => providerTypeForTemplateId(a.templateId) !== null)
          .map((a) => a.id),
      ),
    [apps],
  );

  const missingProvider = useMemo(() => {
    if (!appsLoaded || !connectionsQuery.data) return false;
    return !connectionsQuery.data.connections.some((c) =>
      providerAppIds.has(c.connectionId),
    );
  }, [appsLoaded, connectionsQuery.data, providerAppIds]);

  const staleModel = useStaleModel(agent?.id ?? null);
  const sourceCount = useSkillSourceCount(agent?.id ?? null);
  const { hasRun, pending: configPending } = useResolvedHarnessConfig(
    agent?.id ?? null,
  );

  const { data: budget } = useBudgetReserved();
  const setup =
    agent && budget
      ? formatSizeLabel(sizeInMi(agent.size), slotUnitOf(budget))
      : undefined;

  const { data: currentPreset } = useCurrentPreset(agent?.id ?? null);
  const network = currentPreset ? PRESET_SUMMARY[currentPreset] : undefined;

  const envCount = agent?.env?.filter(
    (e) => !isProtectedAgentEnvName(e.name),
  ).length;
  const environment =
    envCount === undefined
      ? undefined
      : envCount === 0
        ? "No variables"
        : plural(envCount, "variable");

  const connectionTemplates = useConnectionTemplates();
  const templateById = useMemo(
    () => new Map((connectionTemplates.data ?? []).map((t) => [t.id, t])),
    [connectionTemplates.data],
  );
  const connections = useMemo(() => {
    if (!connectionsQuery.data) return undefined;
    const titles = connectionsQuery.data.connections
      .map((c) => c.connectionId)
      .filter((id) => !providerAppIds.has(id))
      .map((id) => apps.find((a) => a.id === id))
      .filter((a) => a !== undefined)
      .map(
        (a) => catalogProviderTitle(templateById.get(a.templateId)) ?? a.name,
      );
    const satelliteNames = satellites
      .filter(
        (s) => agentId !== undefined && s.grantedAgentIds.includes(agentId),
      )
      .map((s) => s.name);
    return (
      formatNameList([...new Set(titles), ...satelliteNames]) ??
      "No connections added"
    );
  }, [
    connectionsQuery.data,
    apps,
    providerAppIds,
    templateById,
    satellites,
    agentId,
  ]);

  const skills = useMemo(() => {
    if (configPending) return undefined;
    if (!hasRun) return "Not known yet";
    const state = skillsState.data;
    if (!state) return undefined;
    const on = state.installed.length;
    const created = state.standalone.length;
    if (on === 0 && created === 0 && sourceCount === 0) return "None yet";
    return sourceCount === null
      ? `${on} on`
      : `${on} on across ${plural(sourceCount, "source")}`;
  }, [hasRun, configPending, skillsState.data, sourceCount]);

  const availableChannels = useAgents().data?.availableChannels;
  const telegramChatCount = useTelegramChats(
    availableChannels?.telegram ? agent?.id : undefined,
  ).data?.chats.length;
  const channelsSummary = useMemo(() => {
    if (!agent || !availableChannels) return undefined;
    if (!availableChannels.slack && !availableChannels.telegram)
      return "No messenger configured";
    const kinds = [
      ...(agent.channels.length > 0 ? ["Slack"] : []),
      ...(telegramChatCount ? ["Telegram"] : []),
    ];
    return kinds.length > 0 ? kinds.join(", ") : "No channels connected";
  }, [agent, availableChannels, telegramChatCount]);

  const schedulesSummary = useMemo(() => {
    if (!agent) return undefined;
    const running = schedules.filter(isUpcoming).length;
    if (running === 0) return "No schedules";
    return `${plural(running, "schedule")} running`;
  }, [agent, schedules]);

  const knowledgeSummary = useMemo(() => {
    if (!appsLoaded || !connectionsQuery.data) return undefined;
    const granted = new Set(
      connectionsQuery.data.connections.map((c) => c.connectionId),
    );
    const count = apps.filter(
      (a) => a.templateId === SHARED_KB_TEMPLATE_ID && granted.has(a.id),
    ).length;
    return count === 0 ? "No knowledge bases" : plural(count, "knowledge base");
  }, [apps, appsLoaded, connectionsQuery.data]);

  const { data: monthSpend, isError: spendUnavailable } = useAgentMonthSpend(
    agent?.id ?? null,
  );
  const usageSummary = useMemo(() => {
    if (spendUnavailable) return "Not available";
    if (monthSpend === undefined) return undefined;
    return monthSpend > 0
      ? `${formatUsdCents(monthSpend)} this month`
      : "No spend this month";
  }, [monthSpend, spendUnavailable]);

  return {
    summaries: {
      setup,
      connections,
      network,
      environment,
      channels: channelsSummary,
      skills,
      schedules: schedulesSummary,
      usage: usageSummary,
      knowledge: knowledgeSummary,
    },
    warnings: missingProvider
      ? {
          setup: configStatus?.harnesses
            ? NO_PROVIDER_CHAT_WARNING
            : NO_PROVIDER_WARNING,
        }
      : staleModel.stale && !configStatus?.harnesses
        ? { setup: STALE_MODEL_WARNING }
        : {},
  };
}
