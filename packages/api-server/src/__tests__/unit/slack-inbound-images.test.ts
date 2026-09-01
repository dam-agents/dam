import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect, beforeEach } from "vitest";
import type { AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { deflateSync } from "node:zlib";
import {
  createSlackWorker,
  type SlackOAuthPending,
} from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import type { DomainEvent } from "../../events.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";
const USER = "U-SENDER";
const CHANNEL = "C-CHAN";
const FILE_URL = "https://files.slack.com/files-pri/T1-F1/screenshot.png";

const logLines: string[] = [];
configureLogger({ level: "info", write: (l) => logLines.push(l) });
beforeEach(() => {
  logLines.length = 0;
});

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

function harness() {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const prompts: Array<string | ContentBlock[]> = [];
  const pending = createMemoryTtlStore<SlackOAuthPending>(600_000);
  const acp: AcpClient = {
    steer: async () => "unsupported" as const,
    listSessions: async () => [],
    sendPrompt: async (prompt) => {
      prompts.push(prompt);
      return "the answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
  };
  const agents = {
    ensureReady: async () => {},
    isAllowedUser: async () => false,
  } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => null } as never,
    {
      keycloakExternalUrl: "http://kc",
      keycloakUrl: "http://kc",
      keycloakRealm: "platform",
      keycloakClientId: "c",
      callbackUrl: "http://ui/api/slack/oauth/callback",
    } as never,
    pending,
    async () => OWNER,
    {
      resolveSlackBindings: async () => [
        {
          instanceName: "agent-1",
          owner: OWNER,
          ambient: false,
          isDefault: true,
        },
      ],
    } as never,
    async () => {},
    async () => {},
    async () => true,
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    stubTurnAttendance(),
    stubWorkspaceFiles(),
    (e) => events.push(e),
  );

  return {
    gw,
    prompts,
    async mentionWithFile(opts: {
      bytes: Buffer;
      mimetype?: string;
      name?: string;
    }) {
      gw.setFileBytes(FILE_URL, opts.bytes);
      await worker.start("agent-1", {} as StoredChannelConfig);
      await gw.fireMention({
        user: USER,
        channel: CHANNEL,
        ts: "1.1",
        text: "what does this say? <@BOT>",
        files: [
          {
            id: "F1",
            name: opts.name ?? "screenshot.png",
            mimetype: opts.mimetype ?? "image/png",
            url_private: FILE_URL,
            size: opts.bytes.length,
          },
        ],
      });
    },
    async startOnly() {
      await worker.start("agent-1", {} as StoredChannelConfig);
    },
    async mentionWithoutSeededFile() {
      await worker.start("agent-1", {} as StoredChannelConfig);
      await gw.fireMention({
        user: USER,
        channel: CHANNEL,
        ts: "1.1",
        text: "look <@BOT>",
        files: [
          {
            id: "F2",
            name: "gone.png",
            mimetype: "image/png",
            url_private: "https://files.slack.com/files-pri/T1-F2/gone.png",
            size: 10,
          },
        ],
      });
    },
    imageBlocks: () =>
      prompts
        .flatMap((p) => (Array.isArray(p) ? p : []))
        .filter((b) => b.type === "image"),
    notices: () =>
      gw
        .readOutbound()
        .map((r) => ("text" in r ? r.text : ""))
        .join("\n"),
    logs: () => logLines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe("slack inbound images", () => {
  it("forwards a decodable screenshot as an image block", async () => {
    const h = harness();
    const bytes = png();
    await h.mentionWithFile({ bytes });

    const images = h.imageBlocks();
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      data: bytes.toString("base64"),
    });
    expect(h.notices()).not.toContain("Couldn't use");
  });

  it("labels the block with the sniffed type, not Slack's claim", async () => {
    const h = harness();
    await h.mentionWithFile({ bytes: png(), mimetype: "image/heic" });

    expect(h.imageBlocks()[0]).toMatchObject({ mimeType: "image/png" });
  });

  it("never sends a web page as an image, and says why (#3008)", async () => {
    const h = harness();
    await h.mentionWithFile({
      bytes: Buffer.from("<!DOCTYPE html><html>Sign in to Slack</html>"),
    });

    expect(h.imageBlocks()).toHaveLength(0);
    const notices = h.notices();
    expect(notices).toContain("Couldn't use attached image 'screenshot.png'");
    expect(notices).toContain("web page instead of the file");
    expect(h.logs().some((l) => l.msg === "slack.image.unreadable")).toBe(true);
  });

  it("names the missing permission when the install confirms it lacks files:read", async () => {
    const h = harness();
    h.gw.setGrantedScopes(["app_mentions:read", "chat:write"]);
    await h.mentionWithFile({
      bytes: Buffer.from("<html>You are not authorized</html>"),
    });

    expect(h.notices()).toContain("`files:read`");
  });

  it("tells the sender which formats work when the file is a phone photo", async () => {
    const h = harness();
    const heic = Buffer.alloc(12);
    heic.writeUInt32BE(12, 0);
    heic.write("ftyp", 4, "ascii");
    heic.write("heic", 8, "ascii");
    await h.mentionWithFile({
      bytes: heic,
      mimetype: "image/heic",
      name: "IMG_0001.heic",
    });

    expect(h.imageBlocks()).toHaveLength(0);
    const notices = h.notices();
    expect(notices).toContain("IMG_0001.heic");
    expect(notices).toContain("PNG, JPEG, GIF and WebP");
  });

  it("still asks the sender to resend when the download itself failed", async () => {
    const h = harness();
    await h.mentionWithoutSeededFile();

    expect(h.imageBlocks()).toHaveLength(0);
    expect(h.notices()).toContain("Try resending");
  });

  it("relays the turn even when the attachment is unusable", async () => {
    const h = harness();
    await h.mentionWithFile({ bytes: Buffer.from("<html>nope</html>") });

    expect(h.prompts).toHaveLength(1);
    expect(String(h.prompts[0])).toContain("what does this say?");
  });

  it("tells the agent an attachment was withheld, so it does not answer blind", async () => {
    const h = harness();
    await h.mentionWithFile({ bytes: Buffer.from("<html>nope</html>") });

    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("could not be read");
    expect(prompt).toContain("screenshot.png");
    expect(prompt).toContain("do not guess");
  });

  it("blames the format, not the permission, for an SVG that arrived intact", async () => {
    const h = harness();
    h.gw.setGrantedScopes(["app_mentions:read", "chat:write"]);
    await h.mentionWithFile({
      bytes: Buffer.from(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
      ),
      mimetype: "image/svg+xml",
      name: "diagram.svg",
    });

    const notices = h.notices();
    expect(notices).toContain("diagram.svg");
    expect(notices).toContain("an SVG image");
    expect(notices).toContain("PNG, JPEG, GIF and WebP");
    expect(notices).not.toContain("files:read");
    expect(notices).not.toContain("web page");
  });

  it("still reads a screenshot whose label is a generic blob", async () => {
    const h = harness();
    const bytes = png();
    await h.mentionWithFile({
      bytes,
      mimetype: "application/octet-stream",
      name: "Screenshot_20260730-000443.png",
    });

    expect(h.imageBlocks()[0]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      data: bytes.toString("base64"),
    });
  });

  it("names the permissions the install lacks, and what they cost, at startup", async () => {
    const h = harness();
    h.gw.setGrantedScopes(["app_mentions:read", "chat:write"]);
    await h.startOnly();

    const report = h
      .logs()
      .find((l) => String(l.msg).startsWith("slack.permissions.missing"));
    expect(report).toBeDefined();
    expect(String(report!.msg)).toContain("files:read");
    expect(String(report!.msg)).toContain("reading the files people attach");
    expect(String(report!.msg)).toContain("Reinstall the app");
    expect(String(report!.msg)).not.toContain("chat:write");
  });

  it("stays silent at startup when the granted permissions are unknown", async () => {
    const h = harness();
    h.gw.setGrantedScopes(null);
    await h.startOnly();

    expect(
      h
        .logs()
        .some((l) => String(l.msg).startsWith("slack.permissions.missing")),
    ).toBe(false);
  });

  it("never shows a document as a picture", async () => {
    const h = harness();
    await h.mentionWithFile({
      bytes: Buffer.from("%PDF-1.7"),
      mimetype: "application/pdf",
      name: "spec.pdf",
    });

    expect(h.imageBlocks()).toHaveLength(0);
    expect(h.notices()).not.toContain("Couldn't use");
  });
});
