import type { SkillRef } from "api-server-api";
import { type ReactNode, useEffect, useState } from "react";

import { api } from "@/api";
import {
  type SkillsDerivations,
  useSkillsDerivations,
} from "@/modules/sandboxes/hooks/use-skills-derivations";
import {
  type SkillsSurface,
  useSkillsSurface,
} from "@/modules/sandboxes/hooks/use-skills-surface";
import { queryClient } from "@/query-client";

import {
  IDS,
  type Scenario,
  scenario,
  setScenario,
} from "../../../backend/scenario";

/** Switches the fake backend's scenario, dropping cached queries when it
 *  changes so an earlier "empty" story doesn't leak into this one. */
export function ensureScenario(wanted: Scenario) {
  if (scenario() === wanted) return;
  setScenario(wanted);
  queryClient.clear();
}

/** `ensureScenario` once, before the story's first render. */
export function useScenario(wanted: Scenario) {
  useState(() => ensureScenario(wanted));
  // Restore the default on unmount so later stories don't inherit "empty".
  useEffect(() => () => ensureScenario("populated"), []);
}

/** Reads the fake backend's skills data for one agent, for stories that pass
 *  it straight into a component as props. */
export async function loadSkills(agentId: string = IDS.codingAgent) {
  ensureScenario("populated");
  const sources = await api.skills.sources.list.query();
  const scans = await Promise.all(
    sources.map((s) => api.skills.listWithScan.query({ sourceId: s.id })),
  );
  const state = await api.skills.state.query({ agentId });
  const local = await api.skills.listLocal.query({ agentId });
  return {
    agentId,
    sources,
    skillsBySource: Object.fromEntries(
      sources.map((s, i) => [s.id, scans[i]!.skills]),
    ),
    scanBySource: Object.fromEntries(sources.map((s, i) => [s.id, scans[i]!])),
    state,
    local,
  };
}
export type LoadedSkills = Awaited<ReturnType<typeof loadSkills>>;

/** Same lookup `useSkillsSurface` hands its children. */
export const installedRefFor =
  (installed: SkillRef[]) => (source: string, name: string) =>
    installed.find((s) => s.source === source && s.name === name);

/** Runs the real surface + derivation hooks against the fake backend and hands
 *  their output to `children`, so container-fed components get real props. */
export function SkillsHarness({
  agentId,
  readOnly = false,
  query = "",
  scenario: wanted = "populated",
  children,
}: {
  agentId: string;
  readOnly?: boolean;
  query?: string;
  scenario?: Scenario;
  children: (surface: SkillsSurface, derived: SkillsDerivations) => ReactNode;
}) {
  useScenario(wanted);
  const surface = useSkillsSurface(agentId, { readOnly, isError: false });
  const derived = useSkillsDerivations(surface, { readOnly, query });
  return <>{children(surface, derived)}</>;
}
