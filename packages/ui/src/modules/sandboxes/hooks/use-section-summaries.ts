import {
  type EgressPreset,
  isProtectedAgentEnvName,
  providerTypeForTemplateId,
} from "api-server-api";
import { useMemo } from "react";

import type { AgentView } from "../../../types.js";
import { useChatFormPreferences } from "../../a2ui/api/queries.js";
import { useChatFormsEnabled } from "../../a2ui/hooks/use-chat-forms-enabled.js";
import {
  useHarnessConfigStatus,
  useResolvedHarnessConfig,
} from "../../agents/api/harness-config.js";
import { useAgentConnections, useAgents } from "../../agents/api/queries.js";
import {
  useSkillSourceCount,
  useSkillsState,
} from "../../agents/api/skills.js";
import { useRootDriver } from "../../agents/hooks/use-root-driver.js";
import { peopleSummary } from "../../agents/lib/agent-editors.js";
import {
  useAppConnections,
  useConnectionTemplates,
} from "../../connections/api/queries.js";
import { catalogProviderTitle } from "../../connections/lib/catalog-providers.js";
import { useCurrentPreset } from "../../egress-rules/api/queries.js";
import { useDefaultModelNotices } from "../../home/hooks/use-default-model-notices.js";
import {
  defaultModelHeadline,
  defaultModelStopsRuns,
} from "../../home/lib/default-model-copy.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { NO_SATELLITES, useSatellites } from "../../satellites/api/queries.js";
import { useSchedules } from "../../schedules/api/queries.js";
import { isUpcoming } from "../../schedules/lib/once-schedule.js";
import { useProviderConnections } from "../../sessions/api/session-pair.js";
import { useAgentSpendStatus } from "../../spend/api/queries.js";
import { agentLimitOf } from "../../spend/lib/agent-limit.js";
import { agentLimitCoverage } from "../../spend/lib/coverage.js";
import {
  formatSpend,
  formatSpendOf,
  formatSpent,
} from "../../spend/lib/format.js";
import { useTelegramChats } from "../../telegram/api/queries.js";

type SectionSummaries = Partial<Record<SandboxSection, string>>;
type SectionWarnings = Partial<Record<SandboxSection, string>>;

const NO_PROVIDER_WARNING =
  "No model provider attached — the agent cannot reach a model";

const PRESET_SUMMARY: Record<EgressPreset, string> = {
  trusted: "Trusted defaults",
  none: "Default-deny",
  all: "Allow everything",
};

const CHAT_FORMS_SUMMARY = {
  all: "Whenever they help",
  input: "Only to ask for input",
  off: "Off",
} as const;

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

  const defaultNotice = useDefaultModelNotices()
    .byAgentEvenDismissed.get(agent?.id ?? "")
    ?.find(defaultModelStopsRuns);
  const sourceCount = useSkillSourceCount(agent?.id ?? null);
  const { hasRun, pending: configPending } = useResolvedHarnessConfig(
    agent?.id ?? null,
  );

  const setup = "Manage this agent";

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
    const names =
      formatNameList([...new Set(titles), ...satelliteNames]) ??
      "No connections added";
    return agent?.requireConnectionAddress
      ? `${names} · addressed only`
      : names;
  }, [
    agent?.requireConnectionAddress,
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
    const enabled = on === 0 ? "None enabled" : `${on} enabled`;
    return sourceCount
      ? `${enabled} from ${plural(sourceCount, "source")}`
      : enabled;
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

  const providers = useProviderConnections(agent?.id ?? null);
  const providersSummary = providers.loaded
    ? providers.granted.length === 0
      ? "None attached"
      : providers.granted.map((p) => p.name).join(", ")
    : undefined;

  const limitCoverage = agentLimitCoverage(
    providers.granted.map((p) => p.templateId),
  );
  const root = useRootDriver(agentId ?? null);
  const rootName = root?.name;
  const { data: spendStatus, isError: spendUnavailable } = useAgentSpendStatus(
    agentId && root === null ? agentId : null,
  );
  const usageSummary = useMemo(() => {
    if (rootName !== undefined) return `Counts toward ${rootName}`;
    if (spendUnavailable) return "Not available";
    if (!spendStatus || !agentId) return undefined;
    const usdMicros =
      spendStatus.spent.find((total) => total.unit === "usd")?.costMicros ?? 0;
    const limit = agentLimitOf(spendStatus, agentId);
    const paid = !providers.loaded || limitCoverage.paid;
    const parts = [
      ...(limit && paid
        ? [formatSpendOf(usdMicros, limit.effectiveMicros, "usd")]
        : usdMicros > 0
          ? [formatSpend(usdMicros, "usd")]
          : []),
      ...spendStatus.spent
        .filter((total) => total.unit !== "usd" && total.costMicros > 0)
        .map((total) => formatSpent(total.costMicros, total.unit)),
    ];
    return parts.length > 0 ? `${parts.join(" · ")} today` : "No spend today";
  }, [
    rootName,
    spendUnavailable,
    spendStatus,
    agentId,
    providers.loaded,
    limitCoverage.paid,
  ]);

  const chatFormsEnabled = useChatFormsEnabled();
  const { data: chatForms } = useChatFormPreferences(
    chatFormsEnabled ? (agentId ?? null) : null,
  );
  const chatFormsSummary = chatForms
    ? [
        CHAT_FORMS_SUMMARY[chatForms.forms],
        ...(chatForms.forms !== "off" && chatForms.pacing === "one-at-a-time"
          ? ["one at a time"]
          : []),
      ].join(" · ")
    : undefined;

  return {
    summaries: {
      setup,
      ...(agent && { people: peopleSummary(agent.access) }),
      "chat-forms": chatFormsSummary,
      providers: providersSummary,
      connections,
      network,
      environment,
      channels: channelsSummary,
      skills,
      schedules: schedulesSummary,
      usage: usageSummary,
    },
    warnings:
      missingProvider && !configStatus?.harnesses
        ? { providers: NO_PROVIDER_WARNING }
        : defaultNotice
          ? { providers: defaultModelHeadline(defaultNotice) }
          : {},
  };
}
