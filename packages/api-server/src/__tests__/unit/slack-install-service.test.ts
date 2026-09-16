import { describe, it, expect } from "vitest";
import {
  createSlackInstallService,
  type SlackInstallServiceDeps,
} from "../../modules/channels/services/slack-install-service.js";
import { ORIGINAL_WORKSPACE } from "../../modules/channels/infrastructure/slack-gateway.js";
import type { SlackInstall } from "../../modules/channels/infrastructure/slack-installs-repository.js";
import type { SecretStore } from "../../modules/secret-store/index.js";

/**
 * TEST_OVERVIEW: Which credential answers for a workspace. The install this
 * platform started with is named by the empty string on every binding made
 * before it could connect a second workspace, while Slack names that same
 * workspace by its real team id on every event it sends. Both have to reach one
 * credential, or the workspace is served by two at once and re-authorizing it —
 * which is how an operator picks up scopes added later — changes nothing.
 */

const ENV_TOKEN = "xoxb-from-helm";
const ORIGINAL_TEAM = "T-ORIGINAL";

function service(opts: {
  installs?: Record<string, SlackInstall>;
  secrets?: Record<string, string>;
  identifiesAs?: string | null;
}) {
  const installs = opts.installs ?? {};
  const identifyCalls: string[] = [];

  const deps: SlackInstallServiceDeps = {
    find: async (teamId) => installs[teamId] ?? null,
    upsert: async () => {},
    setState: async () => {},
    installLock: async (_key, run) => run(),
    envBotToken: ENV_TOKEN,
    identifyWorkspace: async (token) => {
      identifyCalls.push(token);
      return opts.identifiesAs ?? null;
    },
    secrets: {
      storeId: "k8s",
      getField: async ({ path }: { path: string }) =>
        opts.secrets?.[path] ?? null,
    } as unknown as SecretStore,
  };

  return { svc: createSlackInstallService(deps), identifyCalls };
}

function installRow(teamId: string, secretPath: string): SlackInstall {
  return {
    teamId,
    teamName: null,
    secretPath,
    secretField: "botToken",
    installedBy: null,
    credentialState: "active",
  };
}

describe("slack install service — the original workspace's two names", () => {
  /**
   * TEST_SCENARIO: No workspace has been connected yet, which is every install
   * that never runs the handshake. Both names answer with the operator's token,
   * exactly as before this feature existed.
   */
  it("serves the operator's token under either name while no install exists", async () => {
    const { svc } = service({ identifiesAs: ORIGINAL_TEAM });

    expect(await svc.resolveBotToken(ORIGINAL_WORKSPACE)).toBe(ENV_TOKEN);
    expect(await svc.resolveBotToken(ORIGINAL_TEAM)).toBe(ENV_TOKEN);
  });

  /**
   * TEST_SCENARIO: The original workspace re-authorizes, so a row now exists
   * under its real team id. The empty-string name must follow it — otherwise
   * turns keep using the operator's token while inbound work uses the new one,
   * and the newly granted scopes are used nowhere.
   */
  it("follows the install row under both names once that workspace re-authorizes", async () => {
    const { svc } = service({
      identifiesAs: ORIGINAL_TEAM,
      installs: {
        [ORIGINAL_TEAM]: installRow(ORIGINAL_TEAM, "secret-original"),
      },
      secrets: { "secret-original": "xoxb-reauthorized" },
    });

    expect(await svc.resolveBotToken(ORIGINAL_WORKSPACE)).toBe(
      "xoxb-reauthorized",
    );
    expect(await svc.resolveBotToken(ORIGINAL_TEAM)).toBe("xoxb-reauthorized");
  });

  /**
   * TEST_SCENARIO: Slack cannot be asked which workspace the operator's token
   * belongs to — the gateway has not started, or the call failed. The empty
   * string falls back to the operator's token, which is what it has always
   * meant, rather than resolving to nothing and silencing the workspace.
   */
  it("falls back to the operator's token when the original workspace cannot be identified", async () => {
    const { svc } = service({ identifiesAs: null });

    expect(await svc.resolveBotToken(ORIGINAL_WORKSPACE)).toBe(ENV_TOKEN);
  });

  /**
   * TEST_SCENARIO: A failed identification must not be remembered as an answer.
   * The gateway starts after the first attempt, so the next one has to ask
   * again rather than serve a cached nothing for the life of the process.
   */
  it("asks again after a failed identification, and only once after it succeeds", async () => {
    let answer: string | null = null;
    const identifyCalls: string[] = [];
    const svc = createSlackInstallService({
      find: async () => null,
      upsert: async () => {},
      setState: async () => {},
      installLock: async (_key, run) => run(),
      envBotToken: ENV_TOKEN,
      identifyWorkspace: async (token) => {
        identifyCalls.push(token);
        return answer;
      },
      secrets: {
        storeId: "k8s",
        getField: async () => null,
      } as unknown as SecretStore,
    });

    await svc.resolveBotToken(ORIGINAL_WORKSPACE);
    expect(identifyCalls).toHaveLength(1);

    answer = ORIGINAL_TEAM;
    await svc.resolveBotToken(ORIGINAL_WORKSPACE);
    expect(identifyCalls).toHaveLength(2);

    await svc.resolveBotToken(ORIGINAL_WORKSPACE);
    expect(identifyCalls).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: A workspace this platform never recorded. It must get no
   * token: handing it the operator's token would answer for a workspace nobody
   * agreed to serve, using the credential of the one workspace that was set up
   * by hand.
   */
  it("gives no token to a workspace it has no row for", async () => {
    const { svc } = service({ identifiesAs: ORIGINAL_TEAM });

    expect(await svc.resolveBotToken("T-STRANGER")).toBeNull();
  });

  /**
   * TEST_SCENARIO: A refused install, which is the case that matters most here.
   * Slack had already installed the app by the time the organization check
   * turned it away, so its events keep arriving. The refusal is recorded, so it
   * is refused on the strength of its own row and needs no question asked of
   * Slack — including while Slack cannot be asked anything at all.
   */
  it("refuses a workspace whose install was refused, even when Slack cannot be asked", async () => {
    const refused: SlackInstall = {
      teamId: "T-REFUSED",
      teamName: "Somebody else",
      secretPath: null,
      secretField: null,
      installedBy: null,
      credentialState: "rejected",
    };
    const { svc } = service({
      identifiesAs: null,
      installs: { "T-REFUSED": refused },
    });

    expect(await svc.resolveBotToken("T-REFUSED")).toBeNull();
  });

  /**
   * TEST_SCENARIO: Slack cannot say which workspace the operator's token belongs
   * to, and an event arrives naming that workspace by its real team id. Before
   * the identification is available there is no way to tell that id apart from
   * a stranger's, and refusing it would drop the original workspace's own
   * mentions — so the operator's token still answers, and the guess is not
   * written into the token cache, where it would outlive the outage that caused
   * it.
   */
  it("keeps serving the original workspace while its identity is unknown, and caches nothing", async () => {
    let answer: string | null = null;
    const calls: string[] = [];
    const svc = createSlackInstallService({
      find: async () => null,
      upsert: async () => {},
      setState: async () => {},
      installLock: async (_key, run) => run(),
      envBotToken: ENV_TOKEN,
      identifyWorkspace: async (token) => {
        calls.push(token);
        return answer;
      },
      secrets: {
        storeId: "k8s",
        getField: async () => null,
      } as unknown as SecretStore,
    });

    expect(await svc.resolveBotToken(ORIGINAL_TEAM)).toBe(ENV_TOKEN);

    answer = "T-SOMEONE-ELSE";
    expect(await svc.resolveBotToken(ORIGINAL_TEAM)).toBeNull();
    expect(calls).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: Another workspace, which has nothing to do with the operator
   * token, still resolves through its own row.
   */
  it("serves a second workspace from its own install row", async () => {
    const { svc } = service({
      identifiesAs: ORIGINAL_TEAM,
      installs: { "T-SECOND": installRow("T-SECOND", "secret-second") },
      secrets: { "secret-second": "xoxb-second" },
    });

    expect(await svc.resolveBotToken("T-SECOND")).toBe("xoxb-second");
  });
});
