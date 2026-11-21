import { expect } from "@playwright/test";

import type { Person, Persona } from "./people.js";
import type { World } from "./world.js";

/** UNIT_BOUNDARY_DESCRIPTION: one post the platform's bot made to the install's stand-in for Slack, as the e2e control reads it back. */
export type SlackRecord =
  | { kind: "message"; channel: string; text: string; threadTs?: string }
  | { kind: "ephemeral"; channel: string; user: string; text: string }
  | { kind: "reaction"; channel: string; ts: string }
  | { kind: string; channel?: string; channelId?: string };

/** UNIT_BOUNDARY_DESCRIPTION: what an example knows of Slack: the run-unique id of each channel it names, the Slack ids of its personas, the thread each person's last message opened, which personas linked a Slack account, where the log of bot posts stood when the When step began, and the answer of the last slash command. */
export interface SlackState {
  channels: Map<string, string>;
  threads: Map<string, string>;
  linked: Set<Persona>;
  mark: number;
  ack: string;
  sequence: number;
}

const states = new WeakMap<World, SlackState>();

export function slackOf(world: World): SlackState {
  if (!states.has(world))
    states.set(world, {
      channels: new Map(),
      threads: new Map(),
      linked: new Set(),
      mark: 0,
      ack: "",
      sequence: 0,
    });
  return states.get(world)!;
}

/** UNIT_BOUNDARY_DESCRIPTION: a channel's id, unique to the run; never one that starts with D, which Slack keeps for direct messages. */
export function channelId(world: World, name: string): string {
  const slack = slackOf(world);
  if (!slack.channels.has(name))
    slack.channels.set(
      name,
      `C${world.run.toUpperCase()}${name.replace(/[^a-z0-9]/gi, "").toUpperCase()}`,
    );
  return slack.channels.get(name)!;
}

/** UNIT_BOUNDARY_DESCRIPTION: a persona's Slack user id, the same in every run, so its identity link is one row however many runs it took part in. */
export function slackUser(person: Person): string {
  return `U-${person.account.username.toUpperCase()}`;
}

/** UNIT_BOUNDARY_DESCRIPTION: a new message's Slack timestamp: numeric and rising, as Slack's are. */
export function nextTs(world: World): string {
  const slack = slackOf(world);
  slack.sequence += 1;
  return `${Math.floor(Date.now() / 1000)}.${String(slack.sequence).padStart(6, "0")}`;
}

/** UNIT_BOUNDARY_DESCRIPTION: the bot's posts since the When step began. */
export async function postsSinceWhen(
  person: Person,
  world: World,
): Promise<SlackRecord[]> {
  const { records } = await person.api.e2e.slackReadOutbound.query();
  return (records as SlackRecord[]).slice(slackOf(world).mark);
}

/** UNIT_BOUNDARY_DESCRIPTION: marks where the log of bot posts stands, so the Then steps read only what the When step brought. */
export async function markWhen(person: Person, world: World): Promise<void> {
  const { records } = await person.api.e2e.slackReadOutbound.query();
  slackOf(world).mark = records.length;
}

/** UNIT_BOUNDARY_DESCRIPTION: a command's text with each agent the example named replaced by the agent's run-unique name. */
export function withAgentNames(world: World, text: string): string {
  return text
    .split(" ")
    .map((word) => (world.agents.has(word) ? world.nameOf(word) : word))
    .join(" ");
}

/** UNIT_BOUNDARY_DESCRIPTION: waits until a post of the bot since the When step matches. */
export async function untilPosted(
  person: Person,
  world: World,
  match: (record: SlackRecord) => boolean,
  message: string,
  timeout = 180_000,
): Promise<void> {
  try {
    await expect
      .poll(async () => (await postsSinceWhen(person, world)).some(match), {
        timeout,
        intervals: [2_000],
        message,
      })
      .toBe(true);
  } catch (error) {
    world.note({
      step: "slack posts since the When",
      posts: await postsSinceWhen(person, world),
    });
    throw error;
  }
}
