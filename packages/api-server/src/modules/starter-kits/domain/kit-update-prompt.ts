import type { ResolvedStarterKit, SeedStamp } from "api-server-api";
import { describeAccepts } from "./onboarding-prompt.js";
import { type GrantedTemplate, satisfiesRequirement } from "./requirements.js";

export const KIT_UPDATE_PREFERENCES_FILE = "info/kit-update-preferences.md";

export interface KitUpdateFacts {
  stamp: SeedStamp;
  targetCommit: string;
  kit: ResolvedStarterKit | null;
  kitRef: string;
  granted: GrantedTemplate[];
  schedules: { name: string; enabled: boolean }[];
  env: { name: string; value?: string }[];
  familyTitles: ReadonlyMap<string, string>;
}

function checkoutDir(kit: ResolvedStarterKit | null): string {
  return kit?.seed?.into === "home" ? "$HOME" : "your work directory";
}

function connectionLines(facts: KitUpdateFacts, kit: ResolvedStarterKit) {
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

function scheduleLines(facts: KitUpdateFacts, kit: ResolvedStarterKit) {
  if (kit.schedules.length === 0) return ["- Schedules: none declared."];
  const existing = new Map(facts.schedules.map((s) => [s.name, s.enabled]));
  return kit.schedules.map((s) => {
    const timing =
      "cron" in s ? `cron ${s.cron}` : `rrule ${s.rrule} in ${s.timezone}`;
    const mode = s.sessionMode ? `, sessionMode ${s.sessionMode}` : "";
    const state = existing.has(s.name)
      ? `exists (${existing.get(s.name) ? "enabled" : "disabled"})`
      : "MISSING on this agent";
    return `- Schedule "${s.name}" (${timing}${mode}): ${state}. Task: ${s.task}`;
  });
}

function skillLines(kit: ResolvedStarterKit) {
  if (kit.skills.length === 0) return ["- External skills: none declared."];
  return kit.skills.map((s) => `- External skill "${s.name}" from ${s.source}`);
}

function envLines(facts: KitUpdateFacts, kit: ResolvedStarterKit) {
  if (kit.env.length === 0) return ["- Env: none declared."];
  const current = new Map(facts.env.map((e) => [e.name, e.value]));
  return kit.env.map((e) => {
    const state = !current.has(e.name)
      ? "MISSING on this agent"
      : current.get(e.name) === e.value
        ? "matches"
        : "differs on this agent";
    return `- Env ${e.name}=${e.value}: ${state}`;
  });
}

function platformHalf(facts: KitUpdateFacts): string[] {
  const { kit } = facts;
  if (!kit)
    return [
      `The kit ${facts.kitRef} is no longer listed in the catalog, so only the definition updates.`,
    ];
  return [
    "What the kit's current catalog entry declares, against this agent's state right now:",
    ...connectionLines(facts, kit),
    ...scheduleLines(facts, kit),
    ...skillLines(kit),
    ...envLines(facts, kit),
  ];
}

export function composeKitUpdatePrompt(facts: KitUpdateFacts): string {
  const { stamp, targetCommit } = facts;
  const dir = checkoutDir(facts.kit);
  const branch = stamp.branch ?? "the default branch";
  return [
    `The user started a Kit Update of this agent's definition: ${stamp.url} (${branch}) from ${stamp.commit} to ${targetCommit}. The checkout is in ${dir}.`,
    "",
    "Rules for the checkout:",
    "- The user's local changes are theirs alone. NEVER commit them, never push, never open a pull request with them.",
    "- Never run git reset, git clean, or git checkout -f on the checkout.",
    `- Read <git dir>/${KIT_UPDATE_PREFERENCES_FILE} first if it exists. It holds what the user decided in earlier updates; follow it and do not ask again about what it covers.`,
    "",
    "Steps:",
    `1. git fetch origin, then show the user what changed between ${stamp.commit} and ${targetCommit}: the CHANGELOG.md entries in that range if there are any, otherwise the commits, grouped by area. Ask which changes to take. Taking everything is a valid answer.`,
    "2. List the files the user changed locally (git status, git diff). For each file that the update also changes, show both sides and ask the user: keep mine, take the new one, or merge as they describe.",
    `3. Set the local changes aside with git stash, move the checkout with git merge --ff-only ${targetCommit}, then git stash pop. Resolve each conflict the way the user chose.`,
    `4. For every upstream change the user declined, restore the file with git checkout ${stamp.commit} -- <path>. It then stays as one of their local changes.`,
    `5. Ask whether any decision should hold for future updates (for example "always keep my version of X"). Write those to <git dir>/${KIT_UPDATE_PREFERENCES_FILE}. It is outside history and never pushed.`,
    "6. Run the migration steps the definition declares for the versions crossed, if it declares any (CHANGELOG.md Upgrade blocks).",
    "7. Apply the platform half below with the user: create a MISSING schedule only after the user agrees, with create_schedule; install a declared skill the agent lacks with install_skill. You cannot create connections or set env: tell the user exactly which connection to add or which env value to set in the agent's settings.",
    `8. When the checkout is at ${targetCommit} and the user is done, call report_kit_updated with commit ${targetCommit}, even if the user declined every change. If the user wants to stop without updating, call cancel_kit_update instead.`,
    "",
    ...platformHalf(facts),
  ].join("\n");
}
