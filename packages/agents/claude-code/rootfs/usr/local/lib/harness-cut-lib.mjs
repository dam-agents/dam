import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const adapter = "/usr/local/lib/harness/claude-code/adapter";
const sdkPromise = import(`${adapter}/claude-agent-sdk.js`);
sdkPromise.catch(() => {});

const DROPS_TURN_REFUSAL = "Resume rejected by --resume-drops-turn:";

// The bundled SDK cannot find the native CLI beside itself; harness-chat names
// it for the adapter, and the image puts it on PATH beside claude-agent-acp.
function claudeExecutable() {
  if (process.env.CLAUDE_CODE_EXECUTABLE) {
    return process.env.CLAUDE_CODE_EXECUTABLE;
  }
  return execFileSync("sh", ["-c", "command -v claude"], {
    encoding: "utf8",
  }).trim();
}

// getSessionMessages leaves out each entry's parent, so the cut point — the
// chain entry right before the first dropped user entry — is read from the
// transcript itself.
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
        // A line still being written; the entry is read on the next line.
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
 * Cuts a closed session's stored conversation in place: the session keeps
 * every entry before the user entry `before` and goes on from there under the
 * same id, leaving the rest as a dead branch. A resume at an earlier entry
 * saves the cut only with a message after it, so the cut appends one empty
 * note that starts no model turn. `dropsTurn` arms the CLI's guard: the cut is
 * refused, and nothing changes, when it would drop anything but that turn.
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
