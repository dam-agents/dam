import { describe, it, expect } from "vitest";
import {
  createSlackInstallService,
  type SlackInstallServiceDeps,
} from "../../modules/channels/services/slack-install-service.js";
import { ORIGINAL_WORKSPACE } from "../../modules/channels/infrastructure/slack-gateway.js";
import type { SlackInstall } from "../../modules/channels/infrastructure/slack-installs-repository.js";
import type { SecretStore } from "../../modules/secret-store/index.js";

/**
 * TEST_OVERVIEW: Which credential answers for a Slack workspace.
 *
 * A workspace connected over OAuth carries its own id, so nothing about it is
 * ambiguous. The operator's credential is the one that arrives without naming a
 * workspace, and the gateway tells this service which workspace that is before
 * it serves anything. What these scenarios hold is that the workspace's two
 * names — the empty string every binding made before multi-workspace support
 * carries, and the real team id Slack puts on every event — reach one
 * credential, and that a workspace nobody agreed to serve reaches none.
 */

const ENV_TOKEN = "xoxb-from-helm";
const ORIGINAL_TEAM = "T-ORIGINAL";

function service(opts?: {
  installs?: Record<string, SlackInstall>;
  secrets?: Record<string, string>;
}) {
  const installs = opts?.installs ?? {};
  const deps: SlackInstallServiceDeps = {
    find: async (teamId) => installs[teamId] ?? null,
    upsert: async () => {},
    setState: async () => {},
    installLock: async (_key, run) => run(),
    envBotToken: ENV_TOKEN,
    secrets: {
      storeId: "k8s",
      getField: async ({ path }: { path: string }) =>
        opts?.secrets?.[path] ?? null,
    } as unknown as SecretStore,
  };
  return createSlackInstallService(deps);
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

describe("slack install service — which credential answers", () => {
  /**
   * TEST_SCENARIO: The install that never ran the handshake. Both of the
   * original workspace's names answer with the operator's token, which is how
   * it behaved before this platform could connect a second workspace.
   */
  it("serves the operator's token under either name while no install exists", async () => {
    const svc = service();
    svc.setOriginalWorkspace(ORIGINAL_TEAM);

    expect(await svc.resolveBotToken(ORIGINAL_WORKSPACE)).toBe(ENV_TOKEN);
    expect(await svc.resolveBotToken(ORIGINAL_TEAM)).toBe(ENV_TOKEN);
  });

  /**
   * TEST_SCENARIO: The original workspace re-authorizes to pick up scopes added
   * to the manifest later, so a row now exists under its real team id. Both
   * names must follow it — otherwise turns keep using the operator's token
   * while inbound work uses the new one, and the new scopes are used nowhere.
   */
  it("follows the install row under both names once that workspace re-authorizes", async () => {
    const svc = service({
      installs: {
        [ORIGINAL_TEAM]: installRow(ORIGINAL_TEAM, "secret-original"),
      },
      secrets: { "secret-original": "xoxb-reauthorized" },
    });
    svc.setOriginalWorkspace(ORIGINAL_TEAM);

    expect(await svc.resolveBotToken(ORIGINAL_WORKSPACE)).toBe(
      "xoxb-reauthorized",
    );
    expect(await svc.resolveBotToken(ORIGINAL_TEAM)).toBe("xoxb-reauthorized");
  });

  /**
   * TEST_SCENARIO: A workspace this platform has no row for. Slack installs the
   * app the moment an admin consents, so such a workspace can exist and send
   * events — one whose install was refused, or one that installed without this
   * platform's part of the handshake. The operator's credential answers for its
   * own workspace only, so this one is answered for by nothing.
   */
  it("gives no token to a workspace it has no row for", async () => {
    const svc = service();
    svc.setOriginalWorkspace(ORIGINAL_TEAM);

    expect(await svc.resolveBotToken("T-STRANGER")).toBeNull();
  });

  /**
   * TEST_SCENARIO: While the original workspace is unknown the empty string
   * names nothing, so nothing answers it — not even the operator's own token.
   * The state is only reachable when Slack has refused that token, and a
   * workspace that re-authorized in the meantime is served under its real team
   * id; handing the refused token to the empty string would put that one
   * workspace on two credentials, which is what the shared key prevents.
   */
  it("serves nothing under the empty workspace while it has not been told which one that is", async () => {
    const svc = service({
      installs: {
        [ORIGINAL_TEAM]: installRow(ORIGINAL_TEAM, "secret-original"),
      },
      secrets: { "secret-original": "xoxb-reauthorized" },
    });

    expect(await svc.resolveBotToken(ORIGINAL_WORKSPACE)).toBeNull();
    expect(await svc.resolveBotToken(ORIGINAL_TEAM)).toBe("xoxb-reauthorized");
  });

  /**
   * TEST_SCENARIO: Being told which workspace the operator's credential belongs
   * to has to discard anything already decided without knowing it. Nothing
   * reaches this service before the gateway is told, so this guards the
   * invariant rather than a live path — a refusal cached under the original
   * workspace's real id would otherwise outlive the moment it stopped being
   * true.
   */
  it("forgets what it decided before it knew the original workspace", async () => {
    const svc = service();

    expect(await svc.resolveBotToken(ORIGINAL_TEAM)).toBeNull();
    svc.setOriginalWorkspace(ORIGINAL_TEAM);

    expect(await svc.resolveBotToken(ORIGINAL_TEAM)).toBe(ENV_TOKEN);
  });

  /**
   * TEST_SCENARIO: A workspace whose credential Slack has rejected keeps its
   * row so that re-authorizing can clear the mark, but is served nothing in the
   * meantime.
   */
  it("serves nothing for a workspace whose credential was rejected", async () => {
    const svc = service({
      installs: {
        "T-SECOND": {
          ...installRow("T-SECOND", "secret-second"),
          credentialState: "rejected",
        },
      },
      secrets: { "secret-second": "xoxb-second" },
    });
    svc.setOriginalWorkspace(ORIGINAL_TEAM);

    expect(await svc.resolveBotToken("T-SECOND")).toBeNull();
  });

  /**
   * TEST_SCENARIO: Another workspace, which has nothing to do with the operator
   * token, resolves through its own row.
   */
  it("serves a second workspace from its own install row", async () => {
    const svc = service({
      installs: { "T-SECOND": installRow("T-SECOND", "secret-second") },
      secrets: { "secret-second": "xoxb-second" },
    });
    svc.setOriginalWorkspace(ORIGINAL_TEAM);

    expect(await svc.resolveBotToken("T-SECOND")).toBe("xoxb-second");
  });
});
