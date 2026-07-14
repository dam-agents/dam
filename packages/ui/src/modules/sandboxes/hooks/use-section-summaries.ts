import { providerTypeForTemplateId } from "api-server-api";
import { useMemo } from "react";

import type { AgentView } from "../../../types.js";
import {
  useHarnessConfigCurrent,
  useHarnessConfigStatus,
} from "../../agents/api/harness-config.js";
import { useAgentConnections } from "../../agents/api/queries.js";
import { useSkillsState } from "../../agents/api/skills.js";
import {
  type SandboxSubtitleLookup,
  sandboxSubtitleParts,
} from "../../agents/utils/sandbox-subtitle.js";
import { useAppConnections } from "../../connections/api/queries.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { useSchedules } from "../../schedules/api/queries.js";
import { useTemplates } from "../../templates/api/queries.js";

type SectionSummaries = Partial<Record<SandboxSection, string>>;

/** First `max` names, with a "+N more" tail; undefined when the list is empty
 *  so the nav falls back to its neutral placeholder. */
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
export function useSectionSummaries(agent: AgentView | null): SectionSummaries {
  const { data: templates = [] } = useTemplates();
  const { data: apps = [] } = useAppConnections();
  const connectionsQuery = useAgentConnections(agent?.id ?? null);
  const { data: schedules = [] } = useSchedules(agent?.id ?? null);
  const skillsState = useSkillsState(agent?.id ?? null);
  // Catalog is available while asleep; current is operable-gated (never wakes
  // the pod), so the model segment appears only when the pod is up or cached.
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

  const setup = useMemo(() => {
    if (!agent) return undefined;
    const lookup: SandboxSubtitleLookup = {
      templateNameById: new Map(templates.map((t) => [t.id, t.name])),
      connectionTemplateIdById: new Map(apps.map((a) => [a.id, a.templateId])),
    };
    const { harness, provider } = sandboxSubtitleParts(agent, lookup);
    return [harness, provider, modelName].filter(Boolean).join(", ");
  }, [agent, templates, apps, modelName]);

  const connections = useMemo(() => {
    // Providers surface in the Setup line, so the Connections summary lists
    // only the non-provider app grants.
    const names = (connectionsQuery.data?.connections ?? [])
      .map((c) => c.connectionId)
      .filter((id) => !providerAppIds.has(id))
      .map((id) => apps.find((a) => a.id === id)?.name)
      .filter((n): n is string => !!n);
    return formatNameList(names);
  }, [connectionsQuery.data, apps, providerAppIds]);

  const skills = useMemo(
    () =>
      formatNameList((skillsState.data?.installed ?? []).map((s) => s.name)),
    [skillsState.data],
  );

  const schedulesSummary = useMemo(() => {
    if (!agent) return undefined;
    const running = schedules.filter((s) => s.enabled).length;
    if (running === 0) return "No schedules";
    return `${running} Schedule${running === 1 ? "" : "s"} running`;
  }, [agent, schedules]);

  return {
    setup,
    connections,
    skills,
    schedules: schedulesSummary,
  };
}
