import {
  ChannelType,
  formatEgressRuleInline,
  requirementAccepts,
  rruleToText,
  type ChannelConfig,
  type ConnectionTemplateView,
  type ConnectionView,
  type StarterKitConnectionRequirement,
  type StarterKitSchedule,
  type StarterKitView,
} from "api-server-api";

export type TemplateIndex = ReadonlyMap<
  string,
  Pick<ConnectionTemplateView, "id" | "name" | "family">
>;

export type OwnedConnection = Pick<
  ConnectionView,
  "id" | "name" | "templateId" | "isParent"
>;

export function templateIndex(
  templates: readonly Pick<ConnectionTemplateView, "id" | "name" | "family">[],
): TemplateIndex {
  return new Map(templates.map((t) => [t.id, t]));
}

export interface KitSeed {
  kind:
    | "image"
    | "repository"
    | "skill"
    | "network"
    | "login-item"
    | "install"
    | "env"
    | "schedule"
    | "onboarding";
  what: string;
  detail?: string;
}

export interface KitNeed {
  kind: "connection" | "channel" | "schedule";
  required: boolean;
  what: string;
  note?: string;
  command: string;
}

export interface KitStep {
  kind: "connection" | "channel" | "onboarding";
  required: boolean;
  what: string;
  note?: string;
  command: string;
  done: boolean;
}

const NEW_AGENT = "dam agent create <name> --kit <kit>";

export function describeAccepts(
  ids: readonly string[],
  templates: TemplateIndex,
): string {
  const families = new Map<string, string>();
  for (const t of templates.values())
    if (t.family && !families.has(t.family.id))
      families.set(t.family.id, t.family.title);
  return ids
    .map(
      (id) =>
        families.get(id) ??
        templates.get(id)?.name ??
        id.charAt(0).toUpperCase() + id.slice(1),
    )
    .join(" or ");
}

export function scheduleCadence(schedule: StarterKitSchedule): string {
  if ("rrule" in schedule)
    return `${rruleToText(schedule.rrule)} (${schedule.timezone})`;
  return `cron ${schedule.cron} (UTC)`;
}

function briefsOnboarding(kit: Pick<StarterKitView, "onboarding">): boolean {
  return (
    kit.onboarding !== false && !(kit.onboarding && "command" in kit.onboarding)
  );
}

export function kitSeeds(kit: StarterKitView): KitSeed[] {
  const seeds: KitSeed[] = [
    {
      kind: "image",
      what: kit.image ? kit.image.ref : "the deployment's default template",
    },
  ];
  if (kit.seed)
    seeds.push({
      kind: "repository",
      what: kit.seed.url,
      detail: `cloned into the ${kit.seed.into === "home" ? "home" : "work"} directory${kit.seed.ref ? ` on ${kit.seed.ref}` : ""} before the first session`,
    });
  for (const skill of kit.skillsInKit)
    seeds.push({ kind: "skill", what: skill.name, detail: skill.description });
  for (const skill of kit.skills)
    seeds.push({ kind: "skill", what: skill.name, detail: skill.source });
  seeds.push({
    kind: "network",
    what: `egress preset ${kit.egressPreset ?? "trusted"}`,
  });
  for (const rule of kit.egressRules)
    seeds.push({ kind: "network", what: formatEgressRuleInline(rule) });
  for (const item of kit.startupItems)
    seeds.push({
      kind: "login-item",
      what: item.name,
      detail: [item.command, ...item.args].join(" "),
    });
  if (kit.install) seeds.push({ kind: "install", what: kit.install.command });
  for (const variable of kit.env)
    seeds.push({
      kind: "env",
      what: variable.name,
      ...(kit.link && { detail: variable.value }),
    });
  for (const schedule of kit.schedules)
    seeds.push({
      kind: "schedule",
      what: schedule.name,
      detail: `${scheduleCadence(schedule)}${schedule.enabled ? "" : ", off"}`,
    });
  if (kit.onboarding && "command" in kit.onboarding)
    seeds.push({
      kind: "onboarding",
      what: `runs /${kit.onboarding.command} in its first session`,
    });
  else if (briefsOnboarding(kit))
    seeds.push({
      kind: "onboarding",
      what: "a first session that asks you for what the kit needs",
    });
  return seeds;
}

export function ownedMatches(
  requirement: Pick<StarterKitConnectionRequirement, "accepts">,
  owned: readonly OwnedConnection[],
  templates: TemplateIndex,
): OwnedConnection[] {
  return owned.filter(
    (c) =>
      c.isParent !== true &&
      requirementAccepts(
        requirement,
        c.templateId,
        templates.get(c.templateId)?.family?.id,
      ),
  );
}

function connectTemplate(
  requirement: StarterKitConnectionRequirement,
  templates: TemplateIndex,
): string {
  const first = requirement.accepts[0]!;
  if (templates.has(first)) return first;
  return (
    [...templates.values()].find((t) => t.family?.id === first)?.id ?? first
  );
}

function connectionCommand(
  requirement: StarterKitConnectionRequirement,
  templates: TemplateIndex,
  owned: readonly OwnedConnection[],
  agent: string | null,
): string {
  const grant = (ref: string) =>
    agent === null
      ? `${NEW_AGENT} --connection ${shellWord(ref)}`
      : `dam connection grant ${shellWord(agent)} --connection ${shellWord(ref)}`;
  const match = ownedMatches(requirement, owned, templates)[0];
  if (match) return grant(match.name ?? match.id);
  return `dam connection connect ${connectTemplate(requirement, templates)}, then ${grant("<connection>")}`;
}

function channelCommand(
  channel: StarterKitView["channels"][number],
  agent: string | null,
): string {
  if (channel.type === "telegram")
    return "add the Telegram bot to the chat, send /bind there, and pick this agent on the page it opens";
  if (channel.conversation === "direct")
    return "open a direct message with the Slack bot, run its bind command, and pick this agent on the page Slack opens";
  return agent === null
    ? `${NEW_AGENT} --slack-channel <channel-id>`
    : `dam channel slack connect ${shellWord(agent)} --channel-id <channel-id>`;
}

function channelTitle(channel: StarterKitView["channels"][number]): string {
  if (channel.type === "telegram") return "Telegram";
  return channel.conversation === "direct"
    ? "Slack direct message"
    : "Slack channel";
}

export function kitNeeds(
  kit: StarterKitView,
  templates: TemplateIndex,
  owned: readonly OwnedConnection[],
): KitNeed[] {
  return [
    ...kit.connections.map((r) => ({
      kind: "connection" as const,
      required: r.required,
      what: describeAccepts(r.accepts, templates),
      ...(r.note && { note: r.note }),
      command: connectionCommand(r, templates, owned, null),
    })),
    ...kit.channels.map((c) => ({
      kind: "channel" as const,
      required: false,
      what: channelTitle(c),
      ...(c.note && { note: c.note }),
      command: channelCommand(c, null),
    })),
    ...kit.schedules.map((s) => ({
      kind: "schedule" as const,
      required: false,
      what: s.name,
      ...(s.description && { note: s.description }),
      command: `created with the agent; leave it out with ${NEW_AGENT} --skip-schedule ${shellWord(s.name)}`,
    })),
  ];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the connections a new agent from a kit is
 * granted without being named, as the web app preselects them: for each
 * required connection that no named connection meets, the one connection
 * the user owns that it accepts, and none when the user owns none or
 * several.
 */
export function preselectedGrants(
  kit: Pick<StarterKitView, "connections">,
  owned: readonly OwnedConnection[],
  named: readonly string[],
  templates: TemplateIndex,
): string[] {
  const namedConnections = owned.filter((c) => named.includes(c.id));
  const out: string[] = [];
  for (const requirement of kit.connections) {
    if (!requirement.required) continue;
    if (ownedMatches(requirement, namedConnections, templates).length > 0)
      continue;
    const matches = ownedMatches(requirement, owned, templates);
    if (matches.length === 1 && !out.includes(matches[0]!.id))
      out.push(matches[0]!.id);
  }
  return out;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what is left to set up on an agent just
 * created from a kit: each connection the kit asks for and whether a granted
 * one meets it, each channel and whether one of its type is bound, and the
 * onboarding session the kit's briefing opens. Each step names the `dam`
 * command that does it, so a user's agent can work down the list.
 */
export function remainingSteps(
  kit: StarterKitView,
  agent: { name: string; channels: readonly ChannelConfig[] },
  granted: readonly OwnedConnection[],
  owned: readonly OwnedConnection[],
  templates: TemplateIndex,
): KitStep[] {
  const steps: KitStep[] = kit.connections.map((r) => ({
    kind: "connection",
    required: r.required,
    what: describeAccepts(r.accepts, templates),
    ...(r.note && { note: r.note }),
    command: connectionCommand(r, templates, owned, agent.name),
    done: ownedMatches(r, granted, templates).length > 0,
  }));
  for (const channel of kit.channels)
    steps.push({
      kind: "channel",
      required: false,
      what: channelTitle(channel),
      ...(channel.note && { note: channel.note }),
      command: channelCommand(channel, agent.name),
      done:
        channel.type === "slack" &&
        agent.channels.some((c) => c.type === ChannelType.Slack),
    });
  if (briefsOnboarding(kit))
    steps.push({
      kind: "onboarding",
      required: true,
      what: "the agent's first session",
      ...(kit.schedules.length > 0 && {
        note: "the kit's schedules wait until onboarding finishes",
      }),
      command: `dam session list ${shellWord(agent.name)}, then answer it with dam run ${shellWord(agent.name)} --session <session-id> -p "<answer>"`,
      done: false,
    });
  return steps;
}

function shellWord(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./<>-]+$/.test(word)
    ? word
    : `'${word.replace(/'/g, `'\\''`)}'`;
}
