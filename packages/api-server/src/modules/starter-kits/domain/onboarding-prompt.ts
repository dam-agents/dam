import type { StarterKit } from "api-server-api";
import type { GrantedTemplate } from "./requirements.js";
import { satisfiesRequirement } from "./requirements.js";

export interface OnboardingFacts {
  kit: StarterKit;
  catalog: string;
  version: string;
  granted: GrantedTemplate[];
  schedules: { name: string; enabled: boolean }[];
  boundChannels: string[];
  familyTitles: ReadonlyMap<string, string>;
}

export function describeAccepts(
  ids: readonly string[],
  familyTitles: ReadonlyMap<string, string>,
): string {
  return ids
    .map((id) => {
      const title = familyTitles.get(id);
      return title ? `${title} (any method)` : id;
    })
    .join(" or ");
}

function connectionLines(facts: OnboardingFacts): string[] {
  const { kit } = facts;
  if (kit.connections.length === 0) return ["- Connections: none declared."];
  return kit.connections.map((req) => {
    const connected = satisfiesRequirement(req, facts.granted)
      ? "connected"
      : "NOT connected";
    const level = req.required ? "required" : "suggested";
    const note = req.note ? ` — ${req.note}` : "";
    return `- Connection (${level}, ${connected}): ${describeAccepts(req.accepts, facts.familyTitles)}${note}`;
  });
}

function scheduleLines(facts: OnboardingFacts): string[] {
  if (facts.schedules.length === 0) return ["- Schedules: none."];
  return facts.schedules.map(
    (s) => `- Schedule "${s.name}": ${s.enabled ? "enabled" : "disabled"}`,
  );
}

function channelLine(facts: OnboardingFacts): string {
  if (facts.boundChannels.length === 0) return "- Channels: none bound.";
  return `- Channels bound: ${facts.boundChannels.join(", ")}`;
}

function parameterLines(kit: StarterKit): string[] {
  if (kit.parameters.length === 0) return ["(none)"];
  return kit.parameters.map((p) => {
    const note = p.note ? ` — ${p.note}` : "";
    return `- ${p.name} (${p.required ? "required" : "optional"})${note}`;
  });
}

function definitionLine(kit: StarterKit): string {
  if (!kit.seed) return "This kit ships no definition repository.";
  const at = kit.seed.ref ? ` at ref ${kit.seed.ref}` : "";
  return `Definition repository: ${kit.seed.url}${at}. Clone it into your work directory first.`;
}

function defaultInstruction(kit: StarterKit): string {
  return kit.seed
    ? "Then follow ONBOARDING.md at the root of the cloned definition."
    : "Ask the user for the values above, then start the work they describe.";
}

export function composeOnboardingPrompt(facts: OnboardingFacts): string {
  const { kit } = facts;
  const instruction = kit.onboarding?.prompt ?? defaultInstruction(kit);
  return [
    `You were created from the "${kit.name}" starter kit (${facts.catalog}/${kit.id}@${facts.version}).`,
    definitionLine(kit),
    "",
    "This is the agent's state right now, read when this turn was composed. Do not recreate anything marked connected or created; anything marked NOT connected or disabled is not available to you — say so rather than assuming it, and do not ask the user to connect it unless the work needs it.",
    ...connectionLines(facts),
    ...scheduleLines(facts),
    channelLine(facts),
    "",
    "Values only the user can supply:",
    ...parameterLines(kit),
    "",
    instruction,
  ].join("\n");
}
