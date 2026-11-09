import {
  type ConnectionView,
  PROVIDER_TEMPLATE_IDS,
  type SharedChannel,
  sharedChannels,
  type SlackChannel,
  type TelegramChatAudience,
} from "api-server-api";

export interface Audience {
  editors: readonly string[];
  conversations: readonly SharedChannel[];
}

export interface SharedGrants {
  connections: readonly string[];
  satellites: readonly string[];
}

export const NO_GRANTS: SharedGrants = { connections: [], satellites: [] };

const MAX_NAMED = 3;

export function audienceOf(
  agent: {
    access?: { editors: readonly string[] };
    channels: readonly Pick<SlackChannel, "slackChannelId" | "label">[];
  },
  telegramChats: readonly TelegramChatAudience[],
): Audience {
  return {
    editors: agent.access?.editors ?? [],
    conversations: sharedChannels(agent.channels, telegramChats),
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
const SLACK_GROUP_DMS: Noun = {
  one: "everyone in a Slack group DM",
  many: "everyone in the Slack group DMs",
  count: (n) => `everyone in ${n} Slack group DMs`,
};
const OTHER_CONVERSATIONS: Noun = {
  one: "everyone in another conversation",
  many: "everyone in other conversations",
  count: (n) => `everyone in ${n} other conversations`,
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

function tallied(n: number, noun: Noun): string | null {
  if (n === 0) return null;
  return n === 1 ? noun.one : noun.count(n);
}

const namesOf = (
  conversations: readonly SharedChannel[],
  kind: "slack-channel" | "telegram-chat",
): string[] =>
  conversations.flatMap((c) =>
    c.kind === kind ? [c.name ?? "without a name"] : [],
  );

const countOf = (
  conversations: readonly SharedChannel[],
  kind: SharedChannel["kind"],
): number => conversations.filter((c) => c.kind === kind).length;

function phrase(parts: readonly (string | null)[]): string | null {
  const present = parts.filter((p): p is string => p !== null);
  return present.length === 0 ? null : listed(present);
}

const who = ({ editors, conversations }: Audience) =>
  phrase([
    counted(editors, EDITORS),
    counted(namesOf(conversations, "slack-channel"), SLACK_CHANNELS),
    tallied(countOf(conversations, "slack-group-dm"), SLACK_GROUP_DMS),
    counted(namesOf(conversations, "telegram-chat"), TELEGRAM_GROUPS),
    tallied(
      countOf(conversations, "unknown-conversation"),
      OTHER_CONVERSATIONS,
    ),
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
 * everything it holds. Which conversations count is the contract package's
 * rule, the one the web app reads, and model providers are left out, as there.
 * This is the same warning for the CLI, which an AI agent usually drives: one
 * stderr line
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
      "hint: through a connection that signs in as you, each of them acts as you; give an agent others steer a connection with an identity of its own instead, such as a GitHub App (`dam connection connect github-app`), scoped to what they may do",
    );
  if (grants.satellites.length > 0)
    lines.push(
      "hint: a satellite runs their requests on its machine; grant it only to an agent that only you steer",
    );
  return `${lines.join("\n")}\n`;
}
