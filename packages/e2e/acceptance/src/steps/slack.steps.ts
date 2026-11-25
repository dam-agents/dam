import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import { attempt } from "../keys.js";
import type { Person, Persona } from "../people.js";
import {
  channelId,
  markWhen,
  nextTs,
  postsSinceWhen,
  type SlackRecord,
  slackOf,
  slackUser,
  untilPosted,
  withAgentNames,
} from "../slack.js";
import type { World } from "../world.js";

const { Given, When, Then } = createBdd(test);

const linkChannel = (persona: Persona) => `#link-${persona.toLowerCase()}`;

async function join(
  world: World,
  someone: Person,
  channel: string,
  link: boolean,
) {
  await someone.api.e2e.slackAddMember.mutate({
    slackUserId: slackUser(someone),
    channelId: channelId(world, channel),
    linkToCaller: link,
  });
  if (link && !slackOf(world).linked.has(someone.persona)) {
    slackOf(world).linked.add(someone.persona);
    world.undo.push(() =>
      someone.api.e2e.slackFireCommand.mutate({
        text: "logout",
        userId: slackUser(someone),
        channelId: channelId(world, channel),
      }),
    );
  }
}

async function connect(
  world: World,
  owner: Person,
  agent: string,
  channel: string,
  ambient: boolean | undefined,
) {
  const id = world.agent(agent).id;
  await owner.api.agents.connectSlack.mutate({
    id,
    slackChannelId: channelId(world, channel),
    ...(ambient === undefined ? {} : { ambient }),
  });
  world.undo.push(() =>
    owner.api.agents.disconnectSlack.mutate({
      id,
      slackChannelId: channelId(world, channel),
    }),
  );
}

async function channelsOf(owner: Person, world: World, agent: string) {
  const got = await owner.api.agents.get.query({ id: world.agent(agent).id });
  return (
    (
      got as {
        channels?: {
          type: string;
          slackChannelId?: string;
          ambient?: boolean;
          default?: boolean;
        }[];
      }
    ).channels ?? []
  ).filter((c) => c.type === "slack");
}

async function command(
  world: World,
  someone: Person,
  text: string,
  channel: string,
) {
  await markWhen(someone, world);
  const { ack } = await someone.api.e2e.slackFireCommand.mutate({
    text: withAgentNames(world, text),
    userId: slackUser(someone),
    channelId: channelId(world, channel),
  });
  slackOf(world).ack = ack;
  world.note({
    step: "slack command",
    persona: someone.persona,
    text,
    channel,
    ack,
  });
}

async function mention(
  world: World,
  someone: Person,
  channel: string,
  text: string,
) {
  await markWhen(someone, world);
  const ts = nextTs(world);
  slackOf(world).threads.set(`${someone.persona}/${channel}`, ts);
  await someone.api.e2e.slackFireMention.mutate({
    user: slackUser(someone),
    channel: channelId(world, channel),
    ts,
    text: `<@U-BOT> ${text}`,
  });
}

const told = (
  world: World,
  someone: Person,
  channel: string,
  fragment: RegExp,
) =>
  untilPosted(
    someone,
    world,
    (r) =>
      r.kind === "ephemeral" &&
      (r as { user: string }).user === slackUser(someone) &&
      (r as { channel: string }).channel === channelId(world, channel) &&
      fragment.test((r as { text: string }).text),
    `${someone.persona} was not told ${fragment} in ${channel}`,
    60_000,
  ).catch(async (error: unknown) => {
    if (fragment.test(slackOf(world).ack)) return;
    throw error;
  });

const fragmentOf = (text: string) =>
  new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

Given(
  "{word} is in the Slack channel {string}",
  async ({ person, world }, persona: Persona, channel: string) =>
    join(
      world,
      await person(persona),
      channel,
      slackOf(world).linked.has(persona),
    ),
);

Given(
  "{word} has linked a Slack account",
  async ({ person, world }, persona: Persona) =>
    join(world, await person(persona), linkChannel(persona), true),
);

for (const [phrase, ambient] of [
  ["{word} has connected {string} to the Slack channel {string}", undefined],
  [
    "{word} has connected {string} to the Slack channel {string} with ambient mode on",
    true,
  ],
] as const)
  Given(
    phrase,
    async (
      { person, world },
      persona: Persona,
      agent: string,
      channel: string,
    ) => {
      const owner = await person(persona);
      await join(world, owner, channel, true);
      await markWhen(owner, world);
      await connect(world, owner, agent, channel, ambient);
      await untilPosted(
        owner,
        world,
        (r) =>
          r.kind === "message" &&
          (r as { channel: string }).channel === channelId(world, channel) &&
          (r as { text: string }).text.includes(world.nameOf(agent)),
        `no notice in ${channel} that ${agent} was connected`,
        60_000,
      );
      // UNIT_BOUNDARY_DESCRIPTION: a warm agent renamed for this example reaches Slack's own view of the conversation a moment later, so the Given waits until the conversation names it as the example does.
      await expect
        .poll(
          async () => {
            await command(world, owner, "who", channel);
            return slackOf(world).ack;
          },
          { timeout: 60_000, intervals: [3_000] },
        )
        .toContain(world.nameOf(agent));
    },
  );

Given(
  "{word} has disconnected {string} from the Slack channel {string}",
  async ({ person, world }, persona: Persona, agent: string, channel: string) =>
    (await person(persona)).api.agents.disconnectSlack.mutate({
      id: world.agent(agent).id,
      slackChannelId: channelId(world, channel),
    }),
);

Given(
  "{word} has turned whispers off for {string}",
  async ({ person, world }, persona: Persona, agent: string) => {
    const owner = await person(persona);
    const id = world.agent(agent).id;
    await owner.api.agents.setWhisper.mutate({ id, whisper: false });
    world.undo.push(() =>
      owner.api.agents.setWhisper.mutate({ id, whisper: true }),
    );
  },
);

Given(
  "{word} has a running agent called {string} that posts {string} to the Slack channel {string}",
  async (
    { setup, world },
    persona: Persona,
    name: string,
    text: string,
    channel: string,
  ) =>
    setup.runningAgent(persona, name, {
      calls: {
        name: "post",
        arguments: {
          channel: "slack",
          chatId: channelId(world, channel),
          text: world.unique(text),
        },
      },
    }),
);

/** UNIT_BOUNDARY_DESCRIPTION: the slash command's words; a mention that is one of them is sent as typed, since it is the word itself a Rule is about. */
const commandWords = new Set([
  "who",
  "bind",
  "unbind",
  "default",
  "ambient",
  "whisper",
  "help",
  "history",
  "ignore",
  "unignore",
  "delete",
]);

When(
  "{word} mentions the bot in {string} with {string}",
  async ({ person, world }, persona: Persona, channel: string, text: string) =>
    mention(
      world,
      await person(persona),
      channel,
      commandWords.has(text) ? text : world.unique(text),
    ),
);

When(
  "{word} mentions {string} in {string} with {string}",
  async (
    { person, world },
    persona: Persona,
    agent: string,
    channel: string,
    text: string,
  ) =>
    mention(
      world,
      await person(persona),
      channel,
      `${world.nameOf(agent)} ${world.unique(text)}`,
    ),
);

When(
  "{word} posts {string} in {string} without mentioning the bot",
  async (
    { person, world },
    persona: Persona,
    text: string,
    channel: string,
  ) => {
    const someone = await person(persona);
    await markWhen(someone, world);
    const ts = nextTs(world);
    slackOf(world).threads.set(`${persona}/${channel}`, ts);
    await someone.api.e2e.slackFireMessage.mutate({
      user: slackUser(someone),
      channel: channelId(world, channel),
      ts,
      text: world.unique(text),
    });
  },
);

When(
  "{word} runs the Slack command {string} in {string}",
  async ({ person, world }, persona: Persona, text: string, channel: string) =>
    command(world, await person(persona), text, channel),
);

When(
  "{word} whispers {string} to {string} in {string}",
  async (
    { person, world },
    persona: Persona,
    text: string,
    agent: string,
    channel: string,
  ) =>
    command(
      world,
      await person(persona),
      `whisper ${agent} "${world.unique(text)}"`,
      channel,
    ),
);

for (const [phrase, ambient] of [
  ["{word} connects {string} to the Slack channel {string}", undefined],
  [
    "{word} connects {string} to the Slack channel {string} with ambient mode on",
    true,
  ],
] as const)
  When(
    phrase,
    async (
      { person, world },
      persona: Persona,
      agent: string,
      channel: string,
    ) => {
      const owner = await person(persona);
      await markWhen(owner, world);
      world.outcome = await attempt(() =>
        connect(world, owner, agent, channel, ambient),
      );
    },
  );

When(
  "{word} looks at the Slack channels to connect",
  async ({ person, world }, persona: Persona) => {
    world.outcome = await attempt(() =>
      person(persona).then((p) => p.api.channels.slackChannelChoices.query()),
    );
  },
);

When(
  "{word} disconnects {string} from the Slack channel {string}",
  async ({ person, world }, persona: Persona, agent: string, channel: string) =>
    (await person(persona)).api.agents.disconnectSlack.mutate({
      id: world.agent(agent).id,
      slackChannelId: channelId(world, channel),
    }),
);

Then(
  "{string} answers {string} in the thread under {word}'s message in {string}",
  async (
    { person, world },
    agent: string,
    answer: string,
    persona: Persona,
    channel: string,
  ) => {
    const someone = await person(persona);
    const ts = slackOf(world).threads.get(`${persona}/${channel}`);
    await untilPosted(
      someone,
      world,
      (r) =>
        r.kind === "message" &&
        (r as { channel: string }).channel === channelId(world, channel) &&
        (r as { threadTs?: string }).threadTs === ts &&
        (r as { text: string }).text.includes(world.unique(answer)),
      `${agent} did not answer in the thread under ${persona}'s message in ${channel}`,
    );
  },
);

Then(
  "{word} alone is told {string} in {string}",
  async ({ person, world }, persona: Persona, text: string, channel: string) =>
    told(world, await person(persona), channel, fragmentOf(text)),
);

Then(
  "{word} alone is told that {string} has no default agent and {string} is connected",
  async (
    { person, world },
    persona: Persona,
    channel: string,
    agent: string,
  ) => {
    const someone = await person(persona);
    await told(world, someone, channel, /default/i);
    await told(world, someone, channel, fragmentOf(world.nameOf(agent)));
  },
);

Then(
  "{word} alone is told that {string} in {string} belongs to {word} and is the default agent",
  async (
    { person, world },
    persona: Persona,
    agent: string,
    channel: string,
    owner: Persona,
  ) => {
    const someone = await person(persona);
    const ownerId = slackUser(await person(owner));
    await told(world, someone, channel, fragmentOf(world.nameOf(agent)));
    await told(world, someone, channel, fragmentOf(`<@${ownerId}>`));
    await told(world, someone, channel, /the default/i);
  },
);

Then(
  "{word} alone sees {string} answer {string} in {string}",
  async (
    { person, world },
    persona: Persona,
    _agent: string,
    answer: string,
    channel: string,
  ) =>
    untilPosted(
      await person(persona),
      world,
      (r) =>
        r.kind === "ephemeral" &&
        (r as { channel: string }).channel === channelId(world, channel) &&
        (r as { text: string }).text.includes(world.unique(answer)),
      `${persona} saw no private answer in ${channel}`,
    ),
);

Then(
  "nothing is posted in {string} for everyone to see",
  async ({ person, world }, channel: string) => {
    const reader = await person("Ada");
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const posted = (await postsSinceWhen(reader, world)).filter(
      (r: SlackRecord) =>
        (r.kind === "message" || r.kind === "upload") &&
        ((r as { channel?: string }).channel ??
          (r as { channelId?: string }).channelId) ===
          channelId(world, channel),
    );
    expect(posted).toEqual([]);
  },
);

Then(
  "{word} is told nothing privately in {string}",
  async ({ person, world }, persona: Persona, channel: string) => {
    const someone = await person(persona);
    const told = (await postsSinceWhen(someone, world)).filter(
      (r) =>
        r.kind === "ephemeral" &&
        (r as { user: string }).user === slackUser(someone) &&
        (r as { channel: string }).channel === channelId(world, channel),
    );
    expect(told).toEqual([]);
  },
);

Then(
  "nothing reacts to {word}'s message in {string}",
  async ({ person, world }, persona: Persona, channel: string) => {
    const ts = slackOf(world).threads.get(`${persona}/${channel}`);
    const reactions = (
      await postsSinceWhen(await person(persona), world)
    ).filter((r) => r.kind === "reaction" && (r as { ts: string }).ts === ts);
    expect(reactions).toEqual([]);
  },
);

Then(
  "nobody answers {word}'s message in {string} within one minute",
  async ({ person, world }, persona: Persona, channel: string) => {
    const someone = await person(persona);
    const ts = slackOf(world).threads.get(`${persona}/${channel}`);
    await new Promise((resolve) => setTimeout(resolve, 60_000));
    const answers = (await postsSinceWhen(someone, world)).filter(
      (r) =>
        (r.kind === "message" &&
          (r as { threadTs?: string }).threadTs === ts) ||
        (r.kind === "ephemeral" &&
          (r as { user: string }).user === slackUser(someone)),
    );
    expect(answers).toEqual([]);
  },
);

Then(
  "{word} finds no agent connected to {string}",
  async ({ person, world }, persona: Persona, channel: string) => {
    const someone = await person(persona);
    await expect
      .poll(
        async () => {
          await command(world, someone, "who", channel);
          return slackOf(world).ack;
        },
        { timeout: 60_000 },
      )
      .toMatch(/No agent is connected/i);
  },
);

Then(
  "{word} sees a notice in {string} that {string} belongs to {word}",
  async (
    { person, world },
    persona: Persona,
    channel: string,
    agent: string,
    owner: Persona,
  ) => {
    const ownerId = slackUser(await person(owner));
    await untilPosted(
      await person(persona),
      world,
      (r) =>
        r.kind === "message" &&
        (r as { channel: string }).channel === channelId(world, channel) &&
        (r as { threadTs?: string }).threadTs === undefined &&
        (r as { text: string }).text.includes(world.nameOf(agent)) &&
        (r as { text: string }).text.includes(`<@${ownerId}>`),
      `no notice in ${channel} names ${agent} and its owner`,
      60_000,
    );
  },
);

Then(
  "{word} sees {string} post {string} in {string}",
  async (
    { person, world },
    persona: Persona,
    agent: string,
    text: string,
    channel: string,
  ) =>
    untilPosted(
      await person(persona),
      world,
      (r) =>
        r.kind === "message" &&
        (r as { channel: string }).channel === channelId(world, channel) &&
        (r as { text: string }).text.includes(world.unique(text)),
      `${agent} posted nothing in ${channel}`,
    ),
);

for (const [phrase, connected] of [
  ["{word} sees {string} connected to the Slack channel {string}", true],
  [
    "{word} does not see {string} connected to the Slack channel {string}",
    false,
  ],
] as const)
  Then(
    phrase,
    async (
      { person, world },
      persona: Persona,
      agent: string,
      channel: string,
    ) => {
      const owner = await person(persona);
      await expect
        .poll(async () =>
          (await channelsOf(owner, world, agent)).some(
            (c) => c.slackChannelId === channelId(world, channel),
          ),
        )
        .toBe(connected);
    },
  );

for (const [phrase, ambient] of [
  ["{word} sees {string} reading along in the Slack channel {string}", true],
  [
    "{word} sees {string} answering only mentions in the Slack channel {string}",
    false,
  ],
] as const)
  Then(
    phrase,
    async (
      { person, world },
      persona: Persona,
      agent: string,
      channel: string,
    ) => {
      const owner = await person(persona);
      await expect
        .poll(
          async () =>
            (await channelsOf(owner, world, agent)).find(
              (c) => c.slackChannelId === channelId(world, channel),
            )?.ambient ?? false,
        )
        .toBe(ambient);
    },
  );

Then(
  "{word} sees {string} as the default agent of the Slack channel {string}",
  async (
    { person, world },
    persona: Persona,
    agent: string,
    channel: string,
  ) => {
    const owner = await person(persona);
    await expect
      .poll(
        async () =>
          (await channelsOf(owner, world, agent)).find(
            (c) => c.slackChannelId === channelId(world, channel),
          )?.default ?? false,
      )
      .toBe(true);
  },
);

for (const [phrase, offered] of [
  ["{word} sees {string} among the Slack channels to connect", true],
  ["{word} does not see {string} among the Slack channels to connect", false],
] as const)
  Then(phrase, async ({ world }, _persona: Persona, channel: string) => {
    expect(world.outcome?.refused).toBeUndefined();
    const choices = world.outcome!.value as { channels: { id: string }[] };
    expect(
      choices.channels.some((c) => c.id === channelId(world, channel)),
    ).toBe(offered);
  });

Then(
  "{word} is told {string}",
  async ({ world }, _persona: Persona, text: string) => {
    expect(world.outcome?.value, "the request was not refused").toBeUndefined();
    expect(world.outcome?.message).toMatch(fragmentOf(text));
  },
);
