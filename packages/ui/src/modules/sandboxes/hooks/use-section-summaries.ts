import { providerTypeForTemplateId } from "api-server-api";
import { useMemo } from "react";

import type { AgentView } from "../../../types.js";
import {
  useHarnessConfigCurrent,
  useHarnessConfigStatus,
  useResolvedHarnessConfig,
  useStaleModel,
} from "../../agents/api/harness-config.js";
import { useAgentConnections, useAgents } from "../../agents/api/queries.js";
import {
  useSkillSourceCount,
  useSkillsState,
} from "../../agents/api/skills.js";
import {
  type SandboxSubtitleLookup,
  sandboxSubtitleParts,
} from "../../agents/utils/sandbox-subtitle.js";
import { useArtifacts } from "../../artifacts/api/queries.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { catalogProviderTitle } from "../../connections/lib/catalog-providers.js";
import { useAgentMonthSpend } from "../../metrics/api/queries.js";
import { formatUsdCents } from "../../metrics/lib/format.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { useSchedules } from "../../schedules/api/queries.js";
import { useTemplates } from "../../templates/api/queries.js";

type SectionSummaries = Partial<Record<SandboxSection, string>>;
type SectionWarnings = Partial<Record<SandboxSection, string>>;

const STALE_MODEL_WARNING = "Saved model not offered by the current provider";

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
  const { data: templates = [] } = useTemplates();
  const { data: apps = [] } = useAppConnections();
  const connectionsQuery = useAgentConnections(agent?.id ?? null);
  const { data: schedules = [] } = useSchedules(agent?.id ?? null);
  const skillsState = useSkillsState(agent?.id ?? null);
  const { data: configStatus } = useHarnessConfigStatus(agent?.id ?? null);
  const { data: currentConfig } = useHarnessConfigCurrent(agent?.id ?? null);

  const modelName = useMemo(() => {
    const value = currentConfig?.model;
    if (!value) return null;
    const modelGroup = configStatus?.catalog?.options.find(
      (g) => g.id === "model",
    );
    return modelGroup?.choices.find((c) => c.value === value)?.name ?? value;
  }, [currentConfig?.model, configStatus?.catalog]);

  const providerAppIds = useMemo(
    () =>
      new Set(
        apps
          .filter((a) => providerTypeForTemplateId(a.templateId) !== null)
          .map((a) => a.id),
      ),
    [apps],
  );

  const staleModel = useStaleModel(agent?.id ?? null);
  const sourceCount = useSkillSourceCount(agent?.id ?? null);
  const { hasRun, pending: configPending } = useResolvedHarnessConfig(
    agent?.id ?? null,
  );

  const setup = useMemo(() => {
    if (!agent) return undefined;
    const lookup: SandboxSubtitleLookup = {
      templateNameById: new Map(templates.map((t) => [t.id, t.name])),
      connectionTemplateIdById: new Map(apps.map((a) => [a.id, a.templateId])),
    };
    const { harness, provider } = sandboxSubtitleParts(agent, lookup);
    const base = [harness, provider, modelName].filter(Boolean).join(", ");
    return staleModel.stale ? `${base} · not offered` : base;
  }, [agent, templates, apps, modelName, staleModel.stale]);

  const connections = useMemo(() => {
    if (!connectionsQuery.data) return undefined;
    const titles = connectionsQuery.data.connections
      .map((c) => c.connectionId)
      .filter((id) => !providerAppIds.has(id))
      .map((id) => apps.find((a) => a.id === id))
      .filter((a) => a !== undefined)
      .map((a) => catalogProviderTitle(a.templateId) ?? a.name);
    return formatNameList([...new Set(titles)]) ?? "No connections added";
  }, [connectionsQuery.data, apps, providerAppIds]);

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
  const channelsSummary = useMemo(() => {
    if (!agent || !availableChannels) return undefined;
    if (!availableChannels.slack && !availableChannels.telegram)
      return "No messenger configured";
    const kinds = [
      ...new Set(
        agent.channels.map((c) => (c.type === "slack" ? "Slack" : "Telegram")),
      ),
    ];
    return kinds.length > 0 ? kinds.join(", ") : "No channels connected";
  }, [agent, availableChannels]);

  const schedulesSummary = useMemo(() => {
    if (!agent) return undefined;
    const running = schedules.filter((s) => s.enabled).length;
    if (running === 0) return "No schedules";
    return `${running} Schedule${running === 1 ? "" : "s"} running`;
  }, [agent, schedules]);

  const { data: agentArtifacts } = useArtifacts(
    agent ? { agentId: agent.id } : null,
  );
  const artifactsSummary = useMemo(() => {
    if (!agent || !agentArtifacts) return undefined;
    if (agentArtifacts.length === 0) return "No artifacts";
    const shared = agentArtifacts.filter(
      (a) => a.visibility === "public",
    ).length;
    const base = `${agentArtifacts.length} artifact${agentArtifacts.length === 1 ? "" : "s"}`;
    return shared > 0 ? `${base} · ${shared} shared` : base;
  }, [agent, agentArtifacts]);

  const { data: monthSpend } = useAgentMonthSpend(agent?.id ?? null);
  const usageSummary = useMemo(() => {
    if (monthSpend === undefined) return undefined;
    return monthSpend > 0
      ? `${formatUsdCents(monthSpend)} this month`
      : "No spend this month";
  }, [monthSpend]);

  return {
    summaries: {
      setup,
      connections,
      channels: channelsSummary,
      skills,
      schedules: schedulesSummary,
      artifacts: artifactsSummary,
      usage: usageSummary,
    },
    warnings: staleModel.stale ? { setup: STALE_MODEL_WARNING } : {},
  };
}
