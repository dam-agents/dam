/**
 * TEST_OVERVIEW: The settings a harness's home Connection carries for its
 * processes: a harness manifest names them in `connectionEnv`, the runtime
 * takes exactly those names from the Connection whose alias is the harness's
 * home, and the spawn env lays them under every other layer. Bob's Advanced
 * settings (model, mode, cost cap, team, instance) are the case:
 * bob-settings.mjs and harness-terminal read them from the process env, and
 * since the Model Router a Connection's layer stays out of the process
 * otherwise.
 */
import { describe, expect, it } from "vitest";
import { leaseSpawnEnv } from "../../core/runtime-env.js";
import { homeConnectionEnv } from "../../modules/model-router/index.js";
import type { ModelRouterBinding } from "../../modules/runtime-channel/manifest.js";

const bob: ModelRouterBinding = {
  dialects: ["openai-chat"],
  bobGateway: true,
  connectionEnv: [
    "BOB_SHELL_MODEL",
    "BOB_CHAT_MODE",
    "BOB_MAX_COINS",
    "BOB_INSTANCE_ID",
    "BOB_TEAM_ID",
  ],
};
const bobShell = {
  id: "conn-bob",
  template: "bob",
  env: {
    BOBSHELL_API_KEY: "platform:conn:conn-bob",
    BOB_DEFAULT_GATEWAY_URL: "https://api.us-east.bob.ibm.com",
    BOB_MAX_COINS: "1",
    BOB_CHAT_MODE: "plan",
    BOB_TEAM_ID: "team-B",
  },
};
const litellm = {
  id: "conn-ibm",
  template: "ibm-litellm",
  env: {
    BOB_GATEWAY_URL: "https://litellm.example",
    BOBSHELL_API_KEY: "platform:conn:conn-ibm",
    BOB_SHELL_MODEL: "aws/claude-sonnet-4-6",
  },
};

describe("homeConnectionEnv", () => {
  /** TEST_SCENARIO: An owner sets Max cost, Mode and Team ID on the Bob Shell
   * provider. Bob's process gets those three and nothing else of the
   * Connection: the key placeholder and the gateway URL are the router's to
   * set, and a setting the owner left empty is absent, not blank. */
  it("takes the declared names the home Connection carries", () => {
    expect(
      homeConnectionEnv({
        harness: "bob",
        binding: bob,
        layers: [litellm, bobShell],
      }),
    ).toEqual({
      BOB_MAX_COINS: "1",
      BOB_CHAT_MODE: "plan",
      BOB_TEAM_ID: "team-B",
    });
  });

  /** TEST_SCENARIO: The IBM LiteLLM preset carries a Bob model name for the
   * redirect it made before the router. It is not Bob's home Connection, so
   * an agent holding only that Connection runs Bob with no pin at all. */
  it("ignores another Connection that carries one of the names", () => {
    expect(
      homeConnectionEnv({ harness: "bob", binding: bob, layers: [litellm] }),
    ).toEqual({});
  });

  /** TEST_SCENARIO: Claude Code's manifest declares no connectionEnv, so its
   * Anthropic Connection's layer stays out of its process as before the
   * change, and a harness with no router binding gets nothing either. */
  it("gives a harness that declares nothing no Connection env", () => {
    const anthropic = {
      id: "conn-a",
      template: "anthropic",
      env: { ANTHROPIC_API_KEY: "platform:conn:conn-a" },
    };
    expect(
      homeConnectionEnv({
        harness: "claude-code",
        binding: { dialects: ["anthropic-messages"] },
        layers: [anthropic],
      }),
    ).toEqual({});
    expect(
      homeConnectionEnv({
        harness: "claude-code",
        binding: undefined,
        layers: [anthropic],
      }),
    ).toEqual({});
  });
});

describe("leaseSpawnEnv with a home Connection", () => {
  /** TEST_SCENARIO: An owner pins team-B on the Connection and sets
   * BOB_TEAM_ID=team-C in Configure Agent → Env for one agent. That agent's
   * Bob process, chat or terminal, runs on team-C, as the README promises and
   * as the router's profile rewrite resolves the same pair, while the cost
   * cap that only the Connection sets still reaches it and the router's
   * placeholder key outranks the Connection's. */
  it("lays the Connection's settings under the agent's own env", () => {
    const reader = {
      current: () => ({}),
      ready: () => true,
      providers: () => [bobShell.id],
      forLease: () => ({ BOB_TEAM_ID: "team-C" }),
      layerEnvFor: () => ({ BOBSHELL_API_KEY: "platform:conn:router" }),
      connectionEnvFor: (harness: string) =>
        homeConnectionEnv({
          harness,
          binding: bob,
          layers: [
            { ...bobShell, env: { ...bobShell.env, BOBSHELL_API_KEY: "x" } },
          ],
        }),
    };
    const env = leaseSpawnEnv(reader, {
      harness: "bob",
      provider: null,
      model: null,
    });
    expect(env.BOB_TEAM_ID).toBe("team-C");
    expect(env.BOB_MAX_COINS).toBe("1");
    expect(env.BOB_CHAT_MODE).toBe("plan");
    expect(env.BOBSHELL_API_KEY).toBe("platform:conn:router");
    expect(env.PLATFORM_HARNESS).toBe("bob");
  });
});
