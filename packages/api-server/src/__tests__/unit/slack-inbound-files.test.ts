import { beforeEach, describe, expect, it } from "vitest";
import type { AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";

import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { configureLogger } from "../../core/logger.js";
import type { AcpClient } from "../../core/acp-client.js";
import type { DomainEvent } from "../../events.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import {
  createSlackWorker,
  type SlackOAuthPending,
} from "../../modules/channels/infrastructure/slack.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { recordingWorkspaceFiles } from "../helpers/workspace-files.js";

const OWNER = "kc|owner-1";
const USER = "U-SENDER";
const CHANNEL = "C-CHAN";
const FILE_URL = "https://files.slack.com/files-pri/T1-F1/spec.pdf";

const logLines: string[] = [];
configureLogger({ level: "info", write: (l) => logLines.push(l) });
beforeEach(() => {
  logLines.length = 0;
});

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

function harness(opts?: {
  failStagingWith?: Error;
  /** Seed a resumable session for this thread key, so the turn takes the
   *  resume path instead of minting a fresh one. */
  resumableThreadKey?: string;
  /** Fail the resume prompt, forcing the fresh-session fallback. */
  failResume?: boolean;
}) {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const prompts: Array<string | ContentBlock[]> = [];
  const workspace = recordingWorkspaceFiles(
    opts?.failStagingWith ? { failWith: opts.failStagingWith } : undefined,
  );
  const acp: AcpClient = {
    listSessions: async () =>
      opts?.resumableThreadKey
        ? [
            {
              sessionId: "s-1",
              platform: { threadTs: opts.resumableThreadKey },
            } as never,
          ]
        : [],
    sendPrompt: async (prompt, sendOpts) => {
      if (opts?.failResume && "resumeSessionId" in sendOpts) {
        throw new Error("resume failed");
      }
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
    createMemoryTtlStore<SlackOAuthPending>(600_000),
    async () => OWNER,
    {
      resolveSlackBinding: async () => ({
        instanceName: "agent-1",
        owner: OWNER,
        mode: "shared" as const,
        ambient: true,
      }),
    } as never,
    async () => {},
    async () => {},
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    stubTurnAttendance(),
    workspace.factory,
    (e) => events.push(e),
  );

  const attach = (over?: {
    name?: string;
    mimetype?: string;
    size?: number;
  }) => ({
    id: "F1",
    name: over?.name ?? "spec.pdf",
    mimetype: over?.mimetype ?? "application/pdf",
    url_private: FILE_URL,
    size: over?.size ?? PDF.length,
  });

  return {
    gw,
    prompts,
    written: workspace.written,
    /** A mention carrying one attachment whose bytes are `bytes` (omit to leave
     *  the download unseeded, i.e. failing). */
    async mentionWithFile(over?: {
      bytes?: Buffer;
      name?: string;
      mimetype?: string;
      size?: number;
    }) {
      if (over?.bytes) gw.setFileBytes(FILE_URL, over.bytes);
      await worker.start("agent-1", {} as StoredChannelConfig);
      await gw.fireMention({
        user: USER,
        channel: CHANNEL,
        ts: "1.1",
        text: "summarise this <@BOT>",
        files: [attach(over)],
      });
    },
    /** A read-along (ambient) channel message carrying one attachment. */
    async ambientWithFile(bytes: Buffer) {
      gw.setFileBytes(FILE_URL, bytes);
      await worker.start("agent-1", {} as StoredChannelConfig);
      await gw.fireMessage({
        user: USER,
        channel: CHANNEL,
        ts: "2.1",
        text: "here is the spec",
        files: [attach()],
      });
      // The ambient queue drains off the event loop.
      await new Promise((r) => setTimeout(r, 0));
    },
    blocks: () => prompts.flatMap((p) => (Array.isArray(p) ? p : [])),
    links: () =>
      prompts
        .flatMap((p) => (Array.isArray(p) ? p : []))
        .filter((b) => b.type === "resource_link"),
    text: () =>
      prompts
        .map((p) =>
          typeof p === "string"
            ? p
            : p
                .filter((b) => b.type === "text")
                .map((b) => ("text" in b ? b.text : ""))
                .join("\n"),
        )
        .join("\n"),
    notices: () =>
      gw
        .readOutbound()
        .map((r) => ("text" in r ? r.text : ""))
        .join("\n"),
    logs: () => logLines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe("slack inbound documents", () => {
  it("writes an attached document into the agent's workspace and links it", async () => {
    const h = harness();
    await h.mentionWithFile({ bytes: PDF });

    expect(h.written).toHaveLength(1);
    expect(h.written[0]).toMatchObject({
      agentId: "agent-1",
      contentType: "application/pdf",
    });
    expect(h.written[0]!.bytes.equals(PDF)).toBe(true);
    expect(h.links()).toEqual([
      {
        type: "resource_link",
        uri: `file:///home/agent/${h.written[0]!.path}`,
        name: "spec.pdf",
        size: PDF.length,
        mimeType: "application/pdf",
      },
    ]);
    expect(h.notices()).not.toContain("Couldn't use");
  });

  it("names the file's path in the prompt, tied to this message", async () => {
    // The link block carries the path, but a Slack prompt is machine-framed:
    // without a line saying these came with the message, the agent is left to
    // infer that a path it was handed is what it is being asked about.
    const h = harness();
    await h.mentionWithFile({ bytes: PDF });

    const text = h.text();
    expect(text).toContain("attached to this message");
    expect(text).toContain(`spec.pdf → /home/agent/${h.written[0]!.path}`);
    // The question itself still arrives.
    expect(text).toContain("summarise this");
  });

  it("lands the file behind a random prefix, inside its conversation", async () => {
    // Anyone the channel admits can attach a file, so a name the harness reads
    // as instructions (CLAUDE.md, .env) must not be able to become one.
    const h = harness();
    await h.mentionWithFile({ bytes: PDF, name: "CLAUDE.md" });

    expect(h.written[0]!.path).toMatch(
      /^\.uploads\/C-CHAN_1\.1\/[0-9a-f]{8}-CLAUDE\.md$/,
    );
  });

  it.each([
    ["transcript.vtt", "text/vtt"],
    ["notes.txt", "text/plain"],
    ["sheet.xlsx", "application/vnd.ms-excel"],
    ["deck.pptx", "application/vnd.ms-powerpoint"],
    ["rows.csv", "text/csv"],
    ["report.docx", "application/msword"],
    ["archive.zip", "application/zip"],
  ])("delivers %s without consulting a format list", async (name, mimetype) => {
    const h = harness();
    await h.mentionWithFile({ bytes: PDF, name, mimetype });

    expect(h.written).toHaveLength(1);
    expect(h.links()[0]).toMatchObject({ name });
  });

  it("delivers an HTML file even though its bytes look like a served page", async () => {
    // Markup where a PDF was promised means the download failed; markup where
    // an .html was promised is the file.
    const h = harness();
    await h.mentionWithFile({
      bytes: Buffer.from("<!DOCTYPE html><html>a saved page</html>"),
      name: "page.html",
      mimetype: "text/html",
    });

    expect(h.written).toHaveLength(1);
    expect(h.notices()).not.toContain("Couldn't use");
  });

  it("withholds a document whose download returned a sign-in page, and says why", async () => {
    const h = harness();
    h.gw.setGrantedScopes(["app_mentions:read", "chat:write"]);
    await h.mentionWithFile({
      bytes: Buffer.from("<html>Sign in to Slack</html>"),
    });

    expect(h.written).toHaveLength(0);
    const notices = h.notices();
    expect(notices).toContain("Couldn't use attached file 'spec.pdf'");
    expect(notices).toContain("`files:read`");
    expect(notices).toContain("send the file again");
    expect(h.logs().some((l) => l.msg === "slack.file.unreadable")).toBe(true);
  });

  it("asks the sender to resend a document that arrived empty", async () => {
    const h = harness();
    await h.mentionWithFile({ bytes: Buffer.alloc(0), size: 0 });

    expect(h.written).toHaveLength(0);
    expect(h.notices()).toContain("Try resending");
  });

  it("refuses a document over the size limit before downloading it", async () => {
    const h = harness();
    await h.mentionWithFile({ bytes: PDF, size: 80_000_000 });

    expect(h.written).toHaveLength(0);
    const notices = h.notices();
    expect(notices).toContain("80.0 MB");
    expect(notices).toContain("50.0 MB limit");
    // The question still deserves an answer.
    expect(h.text()).toContain("summarise this");
  });

  it("tells the sender and the agent when the file could not be handed over", async () => {
    const h = harness({ failStagingWith: new Error("pod is out of disk") });
    await h.mentionWithFile({ bytes: PDF });

    expect(h.links()).toHaveLength(0);
    expect(h.notices()).toContain("Couldn't use attached file 'spec.pdf'");
    expect(h.notices()).toContain("pod is out of disk");
    const text = h.text();
    expect(text).toContain("could not be read");
    expect(text).toContain("do not guess");
    expect(h.logs().some((l) => l.msg === "slack.file.undelivered")).toBe(true);
  });

  it("records who handed the agent which file", async () => {
    const h = harness();
    await h.mentionWithFile({ bytes: PDF });

    const audit = h.logs().find((l) => l.msg === "channel.file.delivered");
    expect(audit).toMatchObject({
      category: "channel",
      actor: USER,
      actorKind: "external",
      surface: "slack",
      agentId: "agent-1",
      detail: { file: "spec.pdf", bytes: PDF.length },
    });
  });

  it("delivers the file once when a failed resume re-runs the turn", async () => {
    // A resume that fails re-prompts on a fresh session. Staging again would
    // leave the agent with two copies of the same attachment.
    const h = harness({
      resumableThreadKey: `${CHANNEL}:1.1`,
      failResume: true,
    });
    await h.mentionWithFile({ bytes: PDF });

    expect(h.written).toHaveLength(1);
    expect(h.links()).toHaveLength(1);
  });

  it("delivers files on a read-along turn without posting a notice", async () => {
    const h = harness();
    await h.ambientWithFile(PDF);

    expect(h.written).toHaveLength(1);
    expect(h.links()).toHaveLength(1);
    expect(h.notices()).not.toContain("Couldn't use");
  });
});
