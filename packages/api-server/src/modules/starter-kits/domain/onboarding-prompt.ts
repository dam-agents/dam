import { connectionFamilyById, type StarterKit } from "api-server-api";

export interface OnboardingFacts {
  kit: StarterKit;
  version: string;
  schedules: { name: string; enabled: boolean }[];
  boundChannels: string[];
}

export function describeAccepts(ids: readonly string[]): string {
  return ids
    .map((id) => {
      const family = connectionFamilyById(id);
      return family ? `${family.title} (any method)` : id;
    })
    .join(" or ");
}

function connectionLines(kit: StarterKit): string[] {
  if (kit.connections.length === 0) return ["- Connections: none declared."];
  return kit.connections.map((req) => {
    const level = req.required ? "required, granted at create" : "suggested";
    const note = req.note ? ` — ${req.note}` : "";
    return `- Connection (${level}): ${describeAccepts(req.accepts)}${note}`;
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

export function composeOnboardingPrompt(facts: OnboardingFacts): string {
  const { kit } = facts;
  const instruction =
    kit.onboarding?.prompt ??
    "Then follow ONBOARDING.md at the root of the cloned definition.";
  return [
    `You were created from the "${kit.name}" starter kit (${kit.id}@${facts.version}).`,
    definitionLine(kit),
    "",
    "The platform already set up the following. Do not recreate any of it; verify with the tools available to you and ask only for what remains.",
    ...connectionLines(kit),
    ...scheduleLines(facts),
    channelLine(facts),
    "",
    "Values only the user can supply:",
    ...parameterLines(kit),
    "",
    instruction,
  ].join("\n");
}
