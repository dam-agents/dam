import type { StarterKit, TemplateHarness } from "api-server-api";
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

function definitionLine(kit: StarterKit): string {
  if (!kit.seed) return "This kit ships no definition repository.";
  const where =
    kit.seed.into === "home"
      ? "your home directory ($HOME)"
      : "your work directory";
  const branch = kit.seed.ref ? ` on branch ${kit.seed.ref}` : "";
  const at = kit.seed.commit ? ` at ${kit.seed.commit}` : "";
  return `Definition repository: ${kit.seed.url}${branch}${at} — the platform queued its checkout into ${where} before this session. If that directory holds no checkout of it, the seed failed and the user can see the error: say so and stop. Do not clone, fetch or delete anything yourself.`;
}

function defaultInstruction(kit: StarterKit): string {
  if (!kit.seed)
    return "Ask the user what only they can tell you — what to work on, where, and how they want it done — then start the work they describe.";
  const root =
    kit.seed.into === "home" ? "your home directory" : "your work directory";
  return `Then follow ONBOARDING.md at the root of ${root}.`;
}

function releaseLine(holdsSchedules: boolean): string {
  const head = holdsSchedules
    ? "Every schedule on this agent is HELD until you call the mark_onboarding_complete tool, so nothing fires against a half-configured agent."
    : "This agent wears an Onboarding tag until you call the mark_onboarding_complete tool, and any schedule added to it before then is held.";
  return `${head} Call it once, when the configuration above is genuinely in place — not before. If the user leaves onboarding unfinished, leave it uncalled.`;
}

export function composeOnboardingPrompt(facts: OnboardingFacts): string {
  const { kit } = facts;
  const instruction =
    (kit.onboarding && "prompt" in kit.onboarding
      ? kit.onboarding.prompt
      : undefined) ?? defaultInstruction(kit);
  return [
    `You were created from the "${kit.name}" starter kit (${facts.catalog}/${kit.id}@${facts.version}).`,
    definitionLine(kit),
    "",
    "This is the agent's state right now, read when this turn was composed. Do not recreate anything marked connected or created; anything marked NOT connected or disabled is not available to you — say so rather than assuming it, and do not ask the user to connect it unless the work needs it.",
    ...connectionLines(facts),
    ...scheduleLines(facts),
    channelLine(facts),
    "",
    instruction,
    "",
    "Before you ask the user anything, call the set_onboarding_checklist tool with what you need FROM THE USER, so they can watch progress in the platform: one step per value only they can supply, decision only they can make, or action only they can take (installing an app, approving access). Your own work — verifying a connection, writing files, registering schedules, checking the install — is not a step; do it without listing it. Three to six steps is typical. Tick each with complete_onboarding_step the moment the user has supplied it, and call set_onboarding_checklist again if the conversation adds, renames or drops a step; the steps you keep stay ticked.",
    releaseLine(facts.schedules.length > 0),
  ].join("\n");
}

export function kitInitializationTask(
  facts: OnboardingFacts,
  harness: TemplateHarness | undefined,
): string | null {
  const { onboarding } = facts.kit;
  if (onboarding === false) return null;
  if (onboarding && "command" in onboarding)
    return spellHarnessCommand(onboarding.command, harness);
  return composeOnboardingPrompt(facts);
}
