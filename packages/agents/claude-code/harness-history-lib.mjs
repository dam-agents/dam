import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ADAPTER_DIR =
  process.env.CLAUDE_AGENT_ACP_DIR ?? "/usr/local/lib/claude-agent-acp";

let modulesPromise;

async function loadModules() {
  const agent = await import(
    pathToFileURL(`${ADAPTER_DIR}/dist/acp-agent.js`).href
  );
  const sdkCandidates = [
    `${ADAPTER_DIR}/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`,
    `${ADAPTER_DIR}/../../@anthropic-ai/claude-agent-sdk/sdk.mjs`,
  ];
  const sdkPath = sdkCandidates.find((candidate) => existsSync(candidate));
  if (!sdkPath) {
    throw new Error("claude-agent-sdk not found next to the adapter");
  }
  const sdk = await import(pathToFileURL(sdkPath).href);
  return { agent, sdk };
}

function parentToolUseIdOf(message) {
  if (!("parent_tool_use_id" in message)) return null;
  return typeof message.parent_tool_use_id === "string"
    ? message.parent_tool_use_id
    : null;
}

function stripSubagentTextAndThinking(content) {
  if (!Array.isArray(content)) return content;
  return content.filter(
    (item) =>
      !item ||
      typeof item !== "object" ||
      !("type" in item) ||
      (item.type !== "text" && item.type !== "thinking"),
  );
}

const noop = () => {};
const noopLogger = {
  log: noop,
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
};
const noopClient = { sessionUpdate: async () => {} };

export async function loadHistory(sessionId) {
  modulesPromise ??= loadModules();
  const { agent, sdk } = await modulesPromise;

  const info = await sdk.getSessionInfo(sessionId).catch(() => undefined);
  if (!info) throw new Error(`unknown session ${sessionId}`);

  const messages = await sdk.getSessionMessages(sessionId);
  const toolUseCache = {};
  const taskState = new Map();
  const lines = [];

  for (const message of messages) {
    const messageId = agent.messageIdForGrouping(message);
    if (
      message.type === "assistant" &&
      agent.isSyntheticLoginMessage(message.message)
    ) {
      continue;
    }
    let content = message.message.content;
    const parentToolUseId = parentToolUseIdOf(message);
    if (message.type === "assistant" && parentToolUseId) {
      content = stripSubagentTextAndThinking(content);
    }
    if (message.message.role === "user") {
      content = agent.stripLocalCommandMetadata(content);
      if (content === null) continue;
    }
    for (const notification of agent.toAcpNotifications(
      content,
      message.message.role,
      sessionId,
      toolUseCache,
      noopClient,
      noopLogger,
      {
        registerHooks: false,
        cwd: process.cwd(),
        taskState,
        messageId,
        parentToolUseId,
      },
    )) {
      lines.push(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: notification,
        }),
      );
    }
  }
  return lines;
}
