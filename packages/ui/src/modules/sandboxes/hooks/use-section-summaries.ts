import { providerTypeForTemplateId } from "api-server-api";
import { useMemo } from "react";

import { timeAgo } from "@/lib/format-time";

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

/** Why the Setup section is flagged. One string, because the nav renders it as
 *  the marker's accessible name and its tooltip. */
const STALE_MODEL_WARNING = "Saved model not offered by the current provider";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatNameList(names: string[], max = 2): string | undefined {
  if (names.length === 0) return undefined;
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return extra > 0 ? `${shown.join(", ")}, +${extra} more` : shown.join(", ");
}

/**
 * Live one-line summaries for the sandbox section nav. Built from the same
 * cheap list queries used elsewhere — no pod-waking calls, and everything
 * degrades gracefully to an omitted line while the agent is asleep.
 */
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
    // The suffix rides on the model it qualifies, so the line reads as one
    // fact rather than a summary with a warning bolted on.
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

  // Counts, not names: the line has to say something true in four different
  // states, and a list of names can't distinguish "none yet" from "we can't
  // know yet". `on` counts installed skills — the same measure the page's own
  // counts line and its stopped snapshot use, so the number never moves just
  // because the sandbox did.
  const skills = useMemo(() => {
    // While the read is in flight `hasRun` reads false, so the nav's own
    // placeholder is the honest answer. Only a settled false earns the claim.
    if (configPending) return undefined;
    if (!hasRun) return "Not known yet";
    // No skills read yet, or it failed and won't retry: coalescing that to zero
    // would render "0 on" as a fact about a sandbox nobody has asked about.
    const state = skillsState.data;
    if (!state) return undefined;
    const on = state.installed.length;
    const capturedAt = state.standaloneSnapshot?.capturedAt;
    if (capturedAt) return `${on} on · as of ${timeAgo(capturedAt)}`;
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
