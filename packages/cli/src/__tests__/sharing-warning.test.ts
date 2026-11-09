import {
  type ChannelConfig,
  ChannelType,
  type ConnectionView,
  PROVIDER_TEMPLATE_IDS,
} from "api-server-api";
import { describe, expect, it, vi } from "vitest";
import type { AgentView } from "../modules/agent/domain/agent-view.js";
import type { AgentService } from "../modules/agent/index.js";
import { buildSlackConnectCommand } from "../modules/channel/commands/slack-connect.js";
import type { ChannelService } from "../modules/channel/index.js";
import { buildGrantCommand } from "../modules/connection/commands/grant.js";
import { buildGrantCommand as buildSatelliteGrantCommand } from "../modules/satellite/commands/manage.js";
import type { TrpcClient } from "../modules/shared/trpc/trpc-client.js";
import {
  type Audience,
  audienceOf,
  type SharedGrants,
  type SharingService,
  sharingWarning,
} from "../modules/sharing/index.js";
import { captureOutput, deps, ok, output, run } from "./connection-commands.js";

/**
 * TEST_OVERVIEW: Anyone who can steer an Agent uses every connection and
 * satellite it holds: its editors, and everyone in a Slack channel, group DM
 * or Telegram group it is bound to. The web app warns, and never blocks, when
 * a connection or satellite meets such an audience; the CLI, which an AI
 * agent usually drives, prints the same warning on stderr after `dam channel
 * slack connect`, `dam connection grant` and `dam satellite grant`, in every
 * output mode. It names who can use what, and hints at a connection with an
 * identity of its own. A 1:1 DM is the binder's own and model providers carry
 * no identity, so neither warns.
 */

captureOutput();

const AGENT_ID = "agent-00000000000000aa";
const PROVIDER_TEMPLATE = [...PROVIDER_TEMPLATE_IDS][0]!;

const slack = (
  slackChannelId: string,
  label?: ChannelConfig["label"],
): ChannelConfig => ({
  type: ChannelType.Slack,
  slackChannelId,
  ...(label && { label }),
});

const agentView = (over: Partial<AgentView> = {}): AgentView => ({
  id: AGENT_ID,
  name: "scout",
  templateId: null,
  image: "",
  state: "running",
  channels: [],
  ...over,
});

const connection = (
  id: string,
  name: string,
  templateId = "github",
): ConnectionView => ({
  id,
  ownerId: "fixture-user",
  templateId,
  category: "app",
  name,
  status: "active",
  authKind: "oauth",
  contributions: [],
  hosts: ["github.com"],
});

const GITHUB = connection("conn-gh", "github-acme");
const PROVIDER = connection("conn-model", "anthropic", PROVIDER_TEMPLATE);

const NOBODY: Audience = { editors: [], slackChannels: [], telegramGroups: [] };

function sharing(
  over: { telegramGroups?: string[]; held?: SharedGrants } = {},
): () => SharingService {
  return () => ({
    telegramGroups: async () => over.telegramGroups ?? [],
    heldGrants: async () =>
      ok(over.held ?? { connections: [], satellites: [] }),
  });
}

const agentLookup = (agent: AgentView): Partial<AgentService> => ({
  list: async () => ok([agent]),
});

describe("the sharing warning", () => {
  /** TEST_SCENARIO: the warning names each group that can steer the Agent and each thing it shares, so the user knows who acts as them through what. */
  it("names who can use which connections and satellites", () => {
    expect(
      sharingWarning(
        "scout",
        {
          editors: ["ana@example.com"],
          slackChannels: ["#eng"],
          telegramGroups: ["Ops"],
        },
        { connections: ["github-acme", "notion"], satellites: ["laptop"] },
      ),
    ).toBe(
      "warning: its editor ana@example.com, everyone in Slack channel #eng and everyone in Telegram group Ops can steer scout, and through it use its connections github-acme and notion and its satellite laptop\n" +
        "hint: each of them acts as you through a connection that signs in as you; give an agent others steer a connection with an identity of its own, such as a GitHub App (`dam connection connect github-app`), scoped to what they may do\n" +
        "hint: a satellite runs their requests on its machine; grant it only to an agent that only you steer\n",
    );
  });

  /** TEST_SCENARIO: a long list would bury the warning, so more than three of a kind are counted instead of named. */
  it("counts a long list instead of naming it", () => {
    expect(
      sharingWarning(
        "scout",
        { ...NOBODY, editors: ["a@x.io", "b@x.io", "c@x.io", "d@x.io"] },
        { connections: ["github-acme"], satellites: [] },
      ),
    ).toMatch(/^warning: its 4 editors can steer scout,/);
  });

  /** TEST_SCENARIO: nothing is said when nobody else steers the Agent, or when it shares nothing, so the warning keeps its weight. */
  it("says nothing without an audience or anything shared", () => {
    const grants = { connections: ["github-acme"], satellites: [] };
    expect(sharingWarning("scout", NOBODY, grants)).toBe(null);
    expect(
      sharingWarning(
        "scout",
        { ...NOBODY, slackChannels: ["#eng"] },
        { connections: [], satellites: [] },
      ),
    ).toBe(null);
  });

  /** TEST_SCENARIO: a 1:1 DM is the binder's own conversation, so only channels and group DMs make an audience, labelled as Slack names them. */
  it("counts every Slack conversation but a 1:1 DM", () => {
    const audience = audienceOf(
      {
        access: { editors: ["ana@example.com"] },
        channels: [
          slack("D0123"),
          slack("C0456", { kind: "channel", name: "eng" }),
          slack("G0789", { kind: "group-direct-message", members: [] }),
          slack("C0999"),
        ],
      },
      [],
    );
    expect(audience).toEqual({
      editors: ["ana@example.com"],
      slackChannels: ["#eng", "a group DM", "C0999"],
      telegramGroups: [],
    });
  });
});

describe("commands that share an Agent's grants", () => {
  /** TEST_SCENARIO: granting a connection to an Agent that editors and a channel steer warns after the grant succeeds, and still prints the JSON result on stdout. */
  it("warns when a connection is granted to an Agent others steer", async () => {
    const agent = agentView({
      access: { editors: ["ana@example.com"] },
      channels: [slack("C0456", { kind: "channel", name: "eng" })],
    });
    const grant = vi.fn(async () => ok(["conn-gh"]));
    const stdout = await run(
      buildGrantCommand({
        ...deps({ list: async () => ok([GITHUB]), grant }, agentLookup(agent)),
        createSharingService: sharing({ telegramGroups: ["Ops"] }),
      }),
      ["scout", "--connection", "github-acme", "--json"],
    );
    expect(JSON.parse(stdout)).toEqual({
      ok: true,
      agentId: AGENT_ID,
      connectionIds: ["conn-gh"],
    });
    expect(output.stderr).toContain(
      "warning: its editor ana@example.com, everyone in Slack channel #eng and everyone in Telegram group Ops can steer scout, and through it use its connection github-acme\n",
    );
  });

  /** TEST_SCENARIO: a model provider spends money but acts as nobody, and an Agent only its owner steers shares nothing, so neither grant warns. */
  it("does not warn for a model provider or an Agent only its owner steers", async () => {
    const shared = agentView({ channels: [slack("C0456")] });
    await run(
      buildGrantCommand({
        ...deps(
          { list: async () => ok([PROVIDER]), grant: async () => ok([]) },
          agentLookup(shared),
        ),
        createSharingService: sharing(),
      }),
      ["scout", "--connection", "anthropic"],
    );
    expect(output.stderr).not.toContain("warning:");

    await run(
      buildGrantCommand({
        ...deps(
          { list: async () => ok([GITHUB]), grant: async () => ok([]) },
          agentLookup(agentView()),
        ),
        createSharingService: sharing(),
      }),
      ["scout", "--connection", "github-acme"],
    );
    expect(output.stderr).not.toContain("warning:");
  });

  /** TEST_SCENARIO: binding a channel lets everyone in it use what the Agent already holds; binding a 1:1 DM does not, so it does not warn. */
  it("warns when a shared Slack channel is bound, and not for a DM", async () => {
    const agent = agentView();
    const connectSlack = vi.fn(async (_id: string, channelId: string) =>
      ok([slack(channelId)]),
    );
    const channels = {
      available: async () => ok({ [ChannelType.Slack]: true }),
      connectSlack,
    } as unknown as ChannelService;
    const command = () =>
      buildSlackConnectCommand({
        ...deps({}, agentLookup(agent)),
        createChannelService: () => channels,
        createSharingService: sharing({
          held: { connections: ["github-acme"], satellites: ["laptop"] },
        }),
      });

    await run(command(), ["scout", "--channel-id", "C0456"]);
    expect(output.stderr).toContain(
      "warning: everyone in Slack channel C0456 can steer scout, and through it use its connection github-acme and its satellite laptop\n",
    );

    await run(command(), ["scout", "--channel-id", "D0123"]);
    expect(output.stderr).not.toContain("warning:");
  });

  /** TEST_SCENARIO: a satellite granted to an Agent others steer lets them run its tools, so the grant warns. */
  it("warns when a satellite is granted to an Agent others steer", async () => {
    const agent = agentView({ access: { editors: ["ana@example.com"] } });
    const mutate = vi.fn(async () => undefined);
    await run(
      buildSatelliteGrantCommand(
        {
          ...deps({}, agentLookup(agent)),
          createTrpc: () =>
            ({ satellites: { grant: { mutate } } }) as unknown as TrpcClient,
          createSharingService: sharing(),
        },
        false,
      ),
      ["laptop", "scout"],
    );
    expect(mutate).toHaveBeenCalledWith({
      satellite: "laptop",
      agentId: AGENT_ID,
    });
    expect(output.stderr).toContain(
      "warning: its editor ana@example.com can steer scout, and through it use its satellite laptop\n",
    );
  });
});
