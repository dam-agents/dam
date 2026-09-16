import type { HarnessFamily, StarterKit } from "api-server-api";
import { spellHarnessCommand } from "../../templates/index.js";
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
  holds?: boolean;
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
  const at = kit.seed.ref ? ` at ${kit.seed.ref}` : "";
  return `Definition repository: ${kit.seed.url}${at} — the platform queued its checkout into your work directory before this session. If the work directory is empty or holds something else, that checkout failed and the user can see the error: say so and stop. Do not clone, fetch or delete anything yourself.`;
}

function defaultInstruction(kit: StarterKit): string {
  return kit.seed
    ? "Then follow ONBOARDING.md at the root of your work directory."
    : "Ask the user for the values above, then start the work they describe.";
}

export function composeOnboardingPrompt(facts: OnboardingFacts): string {
  const { kit } = facts;
  const instruction =
    (kit.onboarding && "prompt" in kit.onboarding
      ? kit.onboarding.prompt
      : undefined) ?? defaultInstruction(kit);
  const holds = facts.holds ?? facts.schedules.length > 0;
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
    ...(holds
      ? [
          "",
          "Every schedule on this agent is HELD until you call the mark_onboarding_complete tool, so nothing fires against a half-configured agent. Call it once, when the configuration above is genuinely in place — not before. If the user leaves onboarding unfinished, leave it uncalled.",
        ]
      : []),
  ].join("\n");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a kit agent's initialization session opens
 * with, as the kit's `onboarding` field decides: nothing when it opted out, a
 * harness command spelled for the agent's harness when it names one, and the
 * platform-composed briefing otherwise — with the kit's own prompt in place of
 * the default instruction when it gives one.
 */
export function kitInitializationTask(
  facts: OnboardingFacts,
  harness: HarnessFamily | undefined,
): string | null {
  const { onboarding } = facts.kit;
  if (onboarding === false) return null;
  if (onboarding && "command" in onboarding)
    return spellHarnessCommand(onboarding.command, harness);
  return composeOnboardingPrompt(facts);
}
