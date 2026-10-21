import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const adapter = "/usr/local/lib/harness/claude-code/adapter";
const sdkPromise = import(`${adapter}/claude-agent-sdk.js`);
sdkPromise.catch(() => {});

const DROPS_TURN_REFUSAL = "Resume rejected by --resume-drops-turn:";

function claudeExecutable() {
  if (process.env.CLAUDE_CODE_EXECUTABLE) {
    return process.env.CLAUDE_CODE_EXECUTABLE;
  }
  return execFileSync("sh", ["-c", "command -v claude"], {
    encoding: "utf8",
  }).trim();
}

async function parentOf(sessionId, uuid) {
  const root = join(
    process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
    "projects",
  );
  for (const dir of await readdir(root).catch(() => [])) {
    const text = await readFile(
      join(root, dir, `${sessionId}.jsonl`),
      "utf8",
    ).catch(() => null);
    if (text === null) continue;
    for (const line of text.split("\n")) {
      if (!line.includes(uuid)) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.uuid === uuid) return entry.parentUuid ?? null;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

async function* emptyNote() {
  yield {
    type: "user",
    message: { role: "user", content: [] },
    parent_tool_use_id: null,
    session_id: "",
    shouldQuery: false,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Cuts a closed Claude Code session's stored
 * conversation in place, for the runtime's session-cut provider: the session
 * keeps every entry before the user entry `before` and goes on from there
 * under the same id, leaving the rest as a dead branch. The SDK resumes at the
 * chain entry right before `before`, read from the transcript file because
 * getSessionMessages leaves out each entry's parent. A resume at an earlier
 * entry is saved only with a message after it, so the cut sends one empty
 * note that starts no model turn. `dropsTurn` arms the CLI's guard: the cut is
 * refused, and nothing changes, when it would drop anything but that turn. The
 * SDK is the adapter's own bundle, which cannot find the native CLI beside it,
 * so the CLI is the one harness-chat names, or the one on PATH.
 */
export async function cutSession({ sessionId, before, dropsTurn }) {
  const sdk = await sdkPromise;
  const info = await sdk.getSessionInfo(sessionId).catch(() => undefined);
  if (!info) {
    return {
      ok: false,
      refused: true,
      message: `unknown session ${sessionId}`,
    };
  }
  const parent = await parentOf(sessionId, before);
  if (parent === undefined) {
    return {
      ok: false,
      refused: true,
      message: "this message is not in the agent's own history",
    };
  }
  if (parent === null) {
    return {
      ok: false,
      refused: true,
      message: "the conversation cannot be cut before its first message",
    };
  }
  const query = sdk.query({
    prompt: emptyNote(),
    options: {
      cwd: info.cwd ?? process.cwd(),
      resume: sessionId,
      resumeSessionAt: parent,
      ...(dropsTurn !== undefined && { resumeDropsTurn: dropsTurn }),
      pathToClaudeCodeExecutable: claudeExecutable(),
      settingSources: [],
      tools: [],
      mcpServers: {},
    },
  });
  try {
    let result;
    for await (const message of query) {
      if (message.type === "result") result = message;
    }
    if (result?.subtype === "success") return { ok: true };
    const reason = [...(result?.errors ?? []), result?.subtype ?? "no result"]
      .filter(Boolean)
      .join("; ");
    return {
      ok: false,
      refused: reason.includes(DROPS_TURN_REFUSAL),
      message: reason,
    };
  } catch (error) {
    const message = String(error?.message ?? error);
    if (message.includes(DROPS_TURN_REFUSAL)) {
      return {
        ok: false,
        refused: true,
        message: "the agent already answered this message",
      };
    }
    return { ok: false, refused: false, message };
  }
}
