import { describe, it, expect } from "vitest";
import { configureLogger } from "../../core/logger.js";
import type { SlackImageFile } from "../../modules/channels/infrastructure/slack-gateway.js";
import { slackWorkerHarness } from "../helpers/slack-worker.js";
import { recordingWorkspaceFiles } from "../helpers/workspace-files.js";

configureLogger({ level: "error", write: () => {} });

const BOUND = "C1";

const SCREENSHOT_TS = "1758100320.000000";
const MENTION_TS = "1758100380.000000";
const OTHER_TS = "1758100350.000000";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

const TABLE: SlackImageFile = {
  id: "F0TABLE",
  name: "table.png",
  mimetype: "image/png",
  url_private: "https://files.slack.com/files-pri/T1-F0TABLE/table.png",
  size: 240_000,
};

const ATTACHMENT_TAG = /\[attachment: "[^"]*", [^\]]*, fileId (\w+)\]/;

/**
 * TEST_OVERVIEW: What a Slack agent can do with a file posted before it was
 * tagged. People paste a screenshot first and ask about it in a later message,
 * so the history line must say a file was there, and the fileId it prints must
 * fetch that file into the agent's workspace.
 */
function harness() {
  const files = recordingWorkspaceFiles();
  const h = slackWorkerHarness({
    boundChannelId: BOUND,
    channels: [{ id: BOUND, name: "general", botIsMember: true }],
    workspaceFiles: files.factory,
  });
  h.gw.setFileBytes(TABLE.url_private, PNG);
  return { ...h, written: files.written };
}

describe("an attachment on an earlier message", () => {
  /**
   * TEST_SCENARIO: The case from the bug report. An image is posted untagged,
   * and a later message in the same thread tags the agent and asks about it.
   * The test takes the fileId back out of the rendered prompt and fetches with
   * exactly that, so a tag the agent could not act on fails here.
   */
  it("tags the line with the file, and the fileId it prints fetches it", async () => {
    const h = harness();
    h.gw.setHistory([
      {
        ts: SCREENSHOT_TS,
        user: "U999",
        text: "",
        threadTs: SCREENSHOT_TS,
        attachments: [TABLE],
      },
    ]);

    await h.worker.connect();
    await h.gw.fireMention({
      user: "U999",
      channel: BOUND,
      ts: MENTION_TS,
      threadTs: SCREENSHOT_TS,
      text: "<@U-BOT> convert that table to markdown",
    });

    const prompt = String(h.prompts[0]);
    expect(prompt).toContain(
      '[attachment: "table.png", image/png, 0.2 MB, fileId F0TABLE]',
    );
    expect(prompt).toContain("fetch_message_attachment");

    const printed = ATTACHMENT_TAG.exec(prompt)?.at(1);
    expect(printed).toBe(TABLE.id);

    const fetched = await h.worker.fetchAttachment("agent-1", {
      fileId: printed!,
    });

    expect(fetched).toMatchObject({
      name: "table.png",
      size: PNG.length,
      contentType: "image/png",
      conversationId: BOUND,
    });
    expect(h.written).toHaveLength(1);
    expect(h.written[0]).toMatchObject({
      agentId: "agent-1",
      bytes: PNG,
      contentType: "image/png",
    });
    expect(fetched).toHaveProperty("path", `/home/agent/${h.written[0]!.path}`);
  });

  /**
   * TEST_SCENARIO: The tool reaches only files the agent was shown. A fileId
   * that never sat in a tag is refused and nothing is downloaded, even when it
   * names a real file in the workspace.
   */
  it("refuses a fileId no history line offered", async () => {
    const h = harness();
    h.gw.setHistory([{ ts: OTHER_TS, user: "U999", text: "no files here" }]);

    await h.worker.connect();
    await h.gw.fireMention({
      user: "U999",
      channel: BOUND,
      ts: MENTION_TS,
      text: "<@U-BOT> hi",
    });

    const fetched = await h.worker.fetchAttachment("agent-1", {
      fileId: TABLE.id,
    });

    expect(fetched).toHaveProperty("error");
    expect((fetched as { error: string }).error).toContain(
      "not an attachment you were shown",
    );
    expect(h.written).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A file Slack will not hand over is named to the agent as a
   * failure, not delivered as an empty file it might read as the answer.
   */
  it("reports a download Slack refuses instead of writing anything", async () => {
    const h = harness();
    const gone = { ...TABLE, id: "F0GONE", url_private: "https://gone" };
    h.gw.setHistory([
      { ts: SCREENSHOT_TS, user: "U999", text: "", attachments: [gone] },
    ]);

    await h.worker.connect();
    await h.gw.fireMention({
      user: "U999",
      channel: BOUND,
      ts: MENTION_TS,
      text: "<@U-BOT> what does this say",
    });

    const fetched = await h.worker.fetchAttachment("agent-1", {
      fileId: gone.id,
    });

    expect(fetched).toHaveProperty("error");
    expect((fetched as { error: string }).error).toContain(
      "couldn't fetch table.png",
    );
    expect(h.written).toEqual([]);
  });
});
