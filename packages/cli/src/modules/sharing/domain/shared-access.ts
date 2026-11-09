import {
  type ChannelConfig,
  type ConnectionView,
  PROVIDER_TEMPLATE_IDS,
} from "api-server-api";

export interface Audience {
  editors: readonly string[];
  slackChannels: readonly string[];
  telegramGroups: readonly string[];
}

export interface SharedGrants {
  connections: readonly string[];
  satellites: readonly string[];
}

export const NO_GRANTS: SharedGrants = { connections: [], satellites: [] };

const MAX_NAMED = 3;

export const isSlackDirectMessage = (slackChannelId: string): boolean =>
  slackChannelId.startsWith("D");

function slackChannelLabel(channel: ChannelConfig): string | null {
  if (channel.label?.kind === "direct-message") return null;
  if (isSlackDirectMessage(channel.slackChannelId)) return null;
  if (channel.label?.kind === "group-direct-message") return "a group DM";
  if (channel.label?.kind === "channel") return `#${channel.label.name}`;
  return channel.slackChannelId;
}

export function sharedSlackChannels(
  channels: readonly ChannelConfig[],
): string[] {
  return channels.flatMap((c) => {
    const label = slackChannelLabel(c);
    return label === null ? [] : [label];
  });
}

export function audienceOf(
  agent: {
    access?: { editors: readonly string[] };
    channels: readonly ChannelConfig[];
  },
  telegramGroups: readonly string[],
): Audience {
  return {
    editors: agent.access?.editors ?? [],
    slackChannels: sharedSlackChannels(agent.channels),
    telegramGroups,
  };
}

export const sharedConnectionNames = (
  connections: readonly Pick<ConnectionView, "name" | "templateId">[],
): string[] =>
  connections
    .filter((c) => !PROVIDER_TEMPLATE_IDS.has(c.templateId))
    .map((c) => c.name);

function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

interface Noun {
  one: string;
  many: string;
  count: (n: number) => string;
}

const EDITORS: Noun = {
  one: "its editor",
  many: "its editors",
  count: (n) => `its ${n} editors`,
};
const SLACK_CHANNELS: Noun = {
  one: "everyone in Slack channel",
  many: "everyone in the Slack channels",
  count: (n) => `everyone in ${n} Slack channels`,
};
const TELEGRAM_GROUPS: Noun = {
  one: "everyone in Telegram group",
  many: "everyone in the Telegram groups",
  count: (n) => `everyone in ${n} Telegram groups`,
};
const CONNECTIONS: Noun = {
  one: "its connection",
  many: "its connections",
  count: (n) => `its ${n} connections`,
};
const SATELLITES: Noun = {
  one: "its satellite",
  many: "its satellites",
  count: (n) => `its ${n} satellites`,
};

function counted(items: readonly string[], noun: Noun): string | null {
  if (items.length === 0) return null;
  if (items.length === 1) return `${noun.one} ${items[0]}`;
  if (items.length <= MAX_NAMED) return `${noun.many} ${listed(items)}`;
  return noun.count(items.length);
}

function phrase(parts: readonly (string | null)[]): string | null {
  const present = parts.filter((p): p is string => p !== null);
  return present.length === 0 ? null : listed(present);
}

const who = (audience: Audience) =>
  phrase([
    counted(audience.editors, EDITORS),
    counted(audience.slackChannels, SLACK_CHANNELS),
    counted(audience.telegramGroups, TELEGRAM_GROUPS),
  ]);

const what = (grants: SharedGrants) =>
  phrase([
    counted(grants.connections, CONNECTIONS),
    counted(grants.satellites, SATELLITES),
  ]);

export const sharingUnchecked = (agentName: string, reason: string): string =>
  `note: could not check who besides you can use what ${agentName} holds (${reason})\n`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The web app warns, and never blocks, when a
 * connection or satellite is shared with anyone besides an Agent's owner: its
 * editors, and everyone in a Slack channel, group DM or Telegram group it is
 * bound to, since the binding itself lets each of them steer the Agent with
 * everything it holds. Model providers are left out, as there. This is the
 * same warning for the CLI, which an AI agent usually drives: one stderr line
 * that names who can use what, and a hint for each kind of grant, or nothing
 * when nobody else steers the Agent or it shares nothing.
 */
export function sharingWarning(
  agentName: string,
  audience: Audience,
  grants: SharedGrants,
): string | null {
  const whom = who(audience);
  const shared = what(grants);
  if (whom === null || shared === null) return null;
  const lines = [
    `warning: ${whom} can steer ${agentName}, and through it use ${shared}`,
  ];
  if (grants.connections.length > 0)
    lines.push(
      "hint: each of them acts as you through a connection that signs in as you; give an agent others steer a connection with an identity of its own, such as a GitHub App (`dam connection connect github-app`), scoped to what they may do",
    );
  if (grants.satellites.length > 0)
    lines.push(
      "hint: a satellite runs their requests on its machine; grant it only to an agent that only you steer",
    );
  return `${lines.join("\n")}\n`;
}
