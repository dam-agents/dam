const adapter = "/usr/local/lib/harness/claude-code/adapter";
const modulesPromise = Promise.all([
  import(`${adapter}/acp-agent.js`),
  import(`${adapter}/claude-agent-sdk.js`),
]).then(([agent, sdk]) => ({ agent, sdk }));
modulesPromise.catch(() => {});

function parentToolUseIdOf(message) {
  const id = message.parent_tool_use_id;
  return typeof id === "string" ? id : null;
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

function stampOf(message) {
  const timestamp = message.timestamp;
  return typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
    ? timestamp
    : null;
}

function objectOr(value) {
  return typeof value === "object" && value !== null ? value : {};
}

function promptIdOf(message) {
  const id = message.promptId;
  return typeof id === "string" && id !== "" ? id : null;
}

function isToolResultOnly(content) {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((item) => item?.type === "tool_result")
  );
}

function modelOf(message, parentToolUseId) {
  if (message.type !== "assistant" || parentToolUseId) return null;
  const model = message.message.model;
  return typeof model === "string" && model !== "" && model !== "<synthetic>"
    ? model
    : null;
}

function withStamp(notification, at, telemetryPromptId, model) {
  if (at === null && telemetryPromptId === null && model === null)
    return notification;
  const meta = objectOr(notification._meta);
  return {
    ...notification,
    _meta: {
      ...meta,
      platform: {
        ...objectOr(meta.platform),
        ...(at !== null ? { at } : {}),
        ...(telemetryPromptId !== null ? { telemetryPromptId } : {}),
        ...(model !== null ? { model } : {}),
      },
    },
  };
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
  const { agent, sdk } = await modulesPromise;

  const info = await sdk.getSessionInfo(sessionId).catch(() => undefined);
  if (!info) throw new Error(`unknown session ${sessionId}`);

  const messages = await sdk.getSessionMessages(sessionId);
  const toolUseCache = {};
  const taskState = new Map();
  const lines = [];
  let telemetryPromptId = null;

  for (const message of messages) {
    const messageId = agent.messageIdForGrouping(message);
    if (
      message.type === "assistant" &&
      agent.isSyntheticLoginMessage(message.message)
    ) {
      continue;
    }
    const at = stampOf(message);
    let content = message.message.content;
    const parentToolUseId = parentToolUseIdOf(message);
    if (
      message.type === "user" &&
      parentToolUseId === null &&
      !isToolResultOnly(content)
    ) {
      telemetryPromptId = promptIdOf(message);
    }
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
          params: withStamp(
            notification,
            at,
            telemetryPromptId,
            modelOf(message, parentToolUseId),
          ),
        }),
      );
    }
  }
  return lines;
}
