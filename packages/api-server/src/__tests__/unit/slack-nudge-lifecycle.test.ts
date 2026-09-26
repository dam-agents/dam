import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { deflateSync } from "node:zlib";

import type { AgentsService } from "api-server-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AcpClient,
  AcpTurnAbandonedError,
  type SendPromptOpts,
} from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import {
  createSlackWorker,
  type SlackOAuthPending,
} from "../../modules/channels/infrastructure/slack.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";

/**
 * TEST_OVERVIEW: The delivery nudge's own lifecycle. A nudge waiting on a
 * lost turn must not keep the original message's downloaded images alive,
 * because that wait can last hours inside the api-server. A replica that
 * stands down must wait for a nudge already running, up to a limit, and say
 * which way it ended, so a nudge never runs on unaccounted after shutdown.
 */

const OWNER = "kc|owner-1";
const FILE_URL = "https://files.slack.com/files-pri/T1-F1/screenshot.png";

const logLines: string[] = [];
configureLogger({ level: "info", write: (l) => logLines.push(l) });
beforeEach(() => {
  logLines.length = 0;
});

setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;

function png(): Buffer {
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(8 * (1 + 8 * 3)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function harness(opts: {
  sendPrompt: (
    prompt: string | Array<{ type: string }>,
    opts: SendPromptOpts,
  ) => Promise<string>;
  turnStatus: AcpClient["turnStatus"];
}) {
  const gw = createFakeSlackGateway();
  const acp: AcpClient = {
    steer: async () => "unsupported" as const,
    listSessions: async () => [],
    sendPrompt: opts.sendPrompt,
    triggerSession: () => Promise.reject(new Error("unused")),
    turnStatus: opts.turnStatus,
  };
  const agents = {
    ensureReady: async () => {},
    isAllowedUser: async () => false,
    get: async () => ({ state: "running" }),
  } as unknown as AgentsService;

  const worker = createSlackWorker({
    makeAcpClient: () => acp,
    createGateway: () => gw,
    agents: () => agents,
    identityLinks: { resolve: async () => null } as never,
    oauthConfig: {
      keycloakExternalUrl: "http://kc",
      keycloakUrl: "http://kc",
      keycloakRealm: "platform",
      keycloakClientId: "c",
      callbackUrl: "http://ui/api/slack/oauth/callback",
    } as never,
    pendingOAuthFlows: createMemoryTtlStore<SlackOAuthPending>(600_000),
    getInstanceOwner: async () => OWNER,
    channelRegistry: {
      resolveSlackBindings: async () => [
        {
          instanceName: "agent-1",
          owner: OWNER,
          ambient: false,
          isDefault: true,
        },
      ],
    } as never,
    unbindSlackChannel: async () => {},
    setSlackChannelAmbient: async () => {},
    setSlackDefault: async () => true,
    brand: { name: "DAM", short: "dam" },
    isTermsAccepted: async () => true,
    uiBaseUrl: "http://ui",
    attendance: stubTurnAttendance(),
    workspaceFiles: stubWorkspaceFiles(),
    canonicalWorkspace: (teamId) => teamId,
    emit: () => {},
  });

  return {
    worker,
    async mention(withImage: boolean) {
      if (withImage) gw.setFileBytes(FILE_URL, png());
      await worker.connect();
      await gw.fireMention({
        user: "U-SENDER",
        channel: "C-CHAN",
        ts: "1.1",
        text: "what does this say? <@BOT>",
        ...(withImage
          ? {
              files: [
                {
                  id: "F1",
                  name: "screenshot.png",
                  mimetype: "image/png",
                  url_private: FILE_URL,
                  size: png().length,
                },
              ],
            }
          : {}),
      });
    },
    logMessages: () =>
      logLines.map((l) => (JSON.parse(l) as { msg?: string }).msg ?? ""),
  };
}

const abandoned = () =>
  new AcpTurnAbandonedError(
    "connection-lost",
    "ACP connection lost (agent unreachable)",
  );

describe("delivery nudge lifecycle", () => {
  /**
   * TEST_SCENARIO: the relay loses the turn while the agent still works, so
   * the recovery watch holds the nudge for as long as the turn shows life.
   * The nudge needs the thread and the refs, never the downloaded image, so
   * once the relay has returned nothing may keep the image block reachable.
   */
  it("does not keep a watched turn's image alive", async () => {
    let image: WeakRef<object> | undefined;
    const h = harness({
      sendPrompt: async (prompt, sendOpts) => {
        sendOpts.onSession?.("sess-1");
        const block = Array.isArray(prompt)
          ? prompt.find((b) => b.type === "image")
          : undefined;
        if (block) image = new WeakRef(block);
        throw abandoned();
      },
      turnStatus: async () => "pending" as const,
    });

    await h.mention(true);
    expect(image).toBeDefined();

    for (let i = 0; i < 5 && image?.deref() !== undefined; i++) {
      await new Promise((r) => setTimeout(r, 0));
      collectGarbage();
    }
    expect(image?.deref()).toBeUndefined();

    await h.worker.stopAll();
  });

  /**
   * TEST_SCENARIO: a nudge that is already prompting the agent when the
   * replica stands down. Standing down must wait for it, so the nudge's turn
   * is recorded by a replica that is still up.
   */
  it("waits for a running nudge before standing down", async () => {
    let releaseNudge: (() => void) | undefined;
    const h = harness({
      sendPrompt: async (prompt, sendOpts) => {
        sendOpts.onSession?.("sess-1");
        if (String(prompt).includes("<turn-undelivered>")) {
          await new Promise<void>((r) => {
            releaseNudge = r;
          });
          return "prose";
        }
        return "prose, never delivered";
      },
      turnStatus: async () => "unknown" as const,
    });

    await h.mention(false);
    await vi.waitFor(() => expect(releaseNudge).toBeDefined());

    let stood = false;
    const standing = h.worker.stopAll().then(() => {
      stood = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(stood).toBe(false);

    releaseNudge!();
    await standing;
    expect(h.logMessages()).toContainEqual(
      expect.stringContaining("slack.turn.recovery_drained"),
    );
  });

  /**
   * TEST_SCENARIO: a nudge that does not finish within the stand-down limit.
   * Shutdown must not hang on it: it stops waiting at the limit and logs that
   * the nudge was abandoned, so the missing record is visible.
   */
  it("stops waiting for a nudge at the stand-down limit, and says so", async () => {
    vi.useFakeTimers();
    try {
      let nudging = false;
      const h = harness({
        sendPrompt: async (prompt, sendOpts) => {
          sendOpts.onSession?.("sess-1");
          if (String(prompt).includes("<turn-undelivered>")) {
            nudging = true;
            return new Promise<string>(() => {});
          }
          return "prose, never delivered";
        },
        turnStatus: async () => "unknown" as const,
      });

      await h.mention(false);
      await vi.waitFor(() => expect(nudging).toBe(true));

      let stood = false;
      const standing = h.worker.stopAll().then(() => {
        stood = true;
      });
      await vi.advanceTimersByTimeAsync(60_000);
      await standing;

      expect(stood).toBe(true);
      expect(h.logMessages()).toContainEqual(
        expect.stringContaining("slack.turn.recovery_abandoned"),
      );
    } finally {
      vi.useRealTimers();
    }
  });
  /**
   * TEST_SCENARIO: a turn that is still running when the replica stands down,
   * and settles undelivered afterwards. Its verdict would nudge at once, from
   * a replica that has already reported itself stopped, with nothing waiting
   * on it. Standing down must close that door, and say it did.
   */
  it("does not nudge a turn that settles after standing down", async () => {
    let releaseTurn: (() => void) | undefined;
    let prompts = 0;
    const h = harness({
      sendPrompt: async (_prompt, sendOpts) => {
        sendOpts.onSession?.("sess-1");
        prompts += 1;
        await new Promise<void>((r) => {
          releaseTurn = r;
        });
        return "prose, never delivered";
      },
      turnStatus: async () => "unknown" as const,
    });

    const turn = h.mention(false);
    await vi.waitFor(() => expect(releaseTurn).toBeDefined());
    await h.worker.stopAll();
    releaseTurn!();
    await turn;
    await new Promise((r) => setTimeout(r, 20));

    expect(prompts).toBe(1);
    expect(h.logMessages()).toContainEqual(
      expect.stringContaining("slack.turn.recovery_skipped"),
    );
  });
});
