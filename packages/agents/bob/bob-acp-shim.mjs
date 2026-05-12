#!/usr/bin/env node
// ACP translation shim for Bob Shell.
//
// Bob speaks ACP protocol-correctly but uses Cline/Roo conventions that don't
// match platform UI expectations. This shim sits between agent-runtime and bob,
// translating on the way out (bob→client) and handling a few agent→client
// requests locally where the platform client has no useful implementation.
//
// ──────────────────────────────────────────────────────────────────────────
// Translation table (bob → platform UI)
//
//   session/update
//     agent_message_chunk              → processed by a <thinking>…</thinking>
//                                         state machine. Bob emits reasoning
//                                         (same content as agent_thought_chunk)
//                                         wrapped in <thinking> tags, and the
//                                         actual user-facing answer AFTER the
//                                         closing </thinking>. Default state
//                                         is *inside thinking* because bob
//                                         skips the opening tag in some cases.
//                                         "[using tool X: …]" meta hints are
//                                         stripped. Text outside the thinking
//                                         block is emitted as agent_message.
//     agent_thought_chunk (cumulative) → re-emit as incremental delta. Bob
//                                         re-sends the full thought on every
//                                         token; platform UI appends, so without
//                                         delta computation we'd duplicate.
//     tool_call kind="think"           → DROP. Synthetic "attempt_completion"
//                                         wrapper; the real text lives in its
//                                         tool_call_update.content.
//     tool_call_update on think id     → on status=completed, extract nested
//                                         text and emit as final
//                                         agent_message_chunk.
//     all other session/update types   → passthrough (real tool_calls for
//                                         shell exec, their updates, etc.).
//
//   agent→client JSON-RPC requests
//     session/request_permission       → intercepted. Bob bundles the tool
//                                         payload inside params.toolCall for
//                                         permission-gated tools (e.g. file
//                                         edits). We promote it to a
//                                         session/update:tool_call (in_progress)
//                                         so platform UI shows a chip, then auto-
//                                         approve with the first allow-type
//                                         option. Bob's own tool_call_update
//                                         closes the chip later.
//     fs/*                             → dispatched to local handlers below.
//                                         platform UI has no-op stubs that would
//                                         silently swallow writes; the shim
//                                         runs in the same container as the
//                                         agent workdir, so local I/O is the
//                                         right target. Unknown fs/* methods
//                                         are rejected with Method not found
//                                         so bob can fall back.
//     everything else                  → passthrough. If agent-runtime/UI
//                                         can't handle it, the standard JSON-
//                                         RPC "Method not found" will reach
//                                         bob.
//
//   client→agent stdin (human → bob)   → piped through unchanged.
//
// Set BOB_SHIM_TRACE=1 to log every inbound and outbound frame to stderr.
// ──────────────────────────────────────────────────────────────────────────
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { dirname } from "node:path";

const TRACE = process.env.BOB_SHIM_TRACE === "1";
const thinkToolCallIds = new Set();
let lastThoughtText = "";

// agent_message_chunk state machine. Bob wraps reasoning in <thinking>…
// </thinking>; the actual user-facing text is whatever lives outside the
// block. Default state is "inside" because bob skips the opening tag for
// direct-answer turns. messageCarry retains the tail that might contain a
// partial THINK_OPEN/THINK_CLOSE tag split across token boundaries.
//
// outsideBuf accumulates out-of-thinking text for meta-hint filtering.
// Bob peppers "[using tool X: …]" status lines into the message stream,
// which spread over many tokens (e.g. the closing "]" arrives several
// chunks later, with real answer text in between). We strip complete
// "[using tool … ]" segments and keep the tail whenever a still-unclosed
// "[using tool" start is present so we don't ship partial meta to the UI.
const THINK_OPEN = "<thinking>";
const THINK_CLOSE = "</thinking>";
const META_COMPLETE = /\[using tool [^\]]*\]\n?/g;
const META_UNCLOSED = /\[using tool [^\]]*$/;
let messageState = "inside";
let messageCarry = "";
let outsideBuf = "";
let lastSessionId = null;

const bob = spawn("bob", ["--experimental-acp", "--yolo", "--auth-method", "api-key", ...process.argv.slice(2)], {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: process.cwd(),
  env: process.env,
});

process.stdin.pipe(bob.stdin);

function sendToBob(frame) {
  if (!bob.stdin.writable) return;
  const line = JSON.stringify(frame);
  if (TRACE) process.stderr.write(`[shim→bob] ${line}\n`);
  bob.stdin.write(line + "\n");
}

function emitToClient(frame) {
  const line = JSON.stringify(frame);
  if (TRACE) process.stderr.write(`[shim→client] ${line}\n`);
  process.stdout.write(line + "\n");
}

function passthrough(line) {
  if (TRACE) process.stderr.write(`[bob→client] ${line}\n`);
  process.stdout.write(line + "\n");
}

let buf = "";
bob.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  const lines = buf.split("\n");
  buf = lines.pop();
  for (const line of lines) if (line.trim()) handleLine(line);
});

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => bob.kill(sig));
}

bob.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

bob.on("error", (err) => {
  process.stderr.write(`[bob-acp-shim] spawn error: ${err.message}\n`);
  process.exit(1);
});

// ── emitters ──────────────────────────────────────────────────────────────

function update(sessionId, update) {
  emitToClient({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
}

function emitAgentMessage(sessionId, text) {
  update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
}

function emitThoughtChunk(sessionId, text) {
  update(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text } });
}

function emitToolCallOpen(sessionId, toolCall) {
  if (!toolCall?.toolCallId) return;
  update(sessionId, {
    sessionUpdate: "tool_call",
    toolCallId: toolCall.toolCallId,
    status: toolCall.status ?? "in_progress",
    title: toolCall.title,
    content: toolCall.content ?? [],
    locations: toolCall.locations ?? [],
    kind: toolCall.kind,
  });
}

// ── fs dispatcher ─────────────────────────────────────────────────────────
// Add a new entry to extend support (e.g. fs/delete_file). Each handler
// receives the JSON-RPC params and returns the `result` value to send back.

const fsHandlers = {
  async "fs/read_text_file"(params) {
    const path = requireString(params, "path");
    let content;
    try {
      content = await fsp.readFile(path, "utf8");
    } catch (err) {
      // Bob's create-new-file flow reads before writing; ENOENT → empty.
      if (err?.code === "ENOENT") content = "";
      else throw err;
    }
    const line = Number.isInteger(params?.line) ? params.line : null;
    const limit = Number.isInteger(params?.limit) ? params.limit : null;
    if (line !== null || limit !== null) {
      const lines = content.split("\n");
      const start = line !== null ? Math.max(0, line - 1) : 0;
      const end = limit !== null ? start + limit : lines.length;
      content = lines.slice(start, end).join("\n");
    }
    return { content };
  },

  async "fs/write_text_file"(params) {
    const path = requireString(params, "path");
    const content = typeof params?.content === "string" ? params.content : "";
    await fsp.mkdir(dirname(path), { recursive: true });
    await fsp.writeFile(path, content, "utf8");
    return null;
  },
};

function requireString(params, key) {
  const v = params?.[key];
  if (typeof v !== "string" || !v) {
    const err = new Error(`${key} is required`);
    err.jsonrpcCode = -32602;
    throw err;
  }
  return v;
}

async function dispatchFsRequest(frame) {
  const handler = fsHandlers[frame.method];
  if (!handler) {
    sendToBob({
      jsonrpc: "2.0",
      id: frame.id,
      error: { code: -32601, message: `Method not found: ${frame.method}` },
    });
    return;
  }
  try {
    const result = await handler(frame.params);
    sendToBob({ jsonrpc: "2.0", id: frame.id, result });
  } catch (err) {
    sendToBob({
      jsonrpc: "2.0",
      id: frame.id,
      error: { code: err?.jsonrpcCode ?? -32603, message: err?.message ?? String(err) },
    });
  }
}

function flushOutside(sessionId, finalize) {
  if (!outsideBuf) return;
  // Strip complete "[using tool ...]" segments.
  outsideBuf = outsideBuf.replace(META_COMPLETE, "");
  // If a still-unclosed "[using tool" start is present, hold everything from
  // that point onward until the closer arrives (or until turn end, when we
  // conservatively drop it).
  const unclosedAt = outsideBuf.search(META_UNCLOSED);
  if (unclosedAt !== -1 && !finalize) {
    const emit = outsideBuf.slice(0, unclosedAt);
    outsideBuf = outsideBuf.slice(unclosedAt);
    if (emit) emitAgentMessage(sessionId, emit);
    return;
  }
  if (finalize) outsideBuf = outsideBuf.replace(META_UNCLOSED, "");
  if (outsideBuf) emitAgentMessage(sessionId, outsideBuf);
  outsideBuf = "";
}

function processMessageChunk(sessionId, text) {
  lastSessionId = sessionId;
  let buf = messageCarry + text;
  messageCarry = "";

  while (buf.length > 0) {
    if (messageState === "inside") {
      const idx = buf.indexOf(THINK_CLOSE);
      if (idx === -1) {
        // Retain a short tail so a </thinking> split across chunks matches next time.
        messageCarry = buf.slice(-(THINK_CLOSE.length - 1));
        return;
      }
      messageState = "outside";
      buf = buf.slice(idx + THINK_CLOSE.length);
      continue;
    }

    const idx = buf.indexOf(THINK_OPEN);
    const chunkEnd = idx === -1 ? buf.length : idx;
    outsideBuf += buf.slice(0, chunkEnd);
    flushOutside(sessionId, false);

    if (idx === -1) {
      // Any remaining chars in outsideBuf came from flushOutside's unclosed-meta
      // hold; don't touch that. The chars we'd want to retain to catch a
      // <thinking> tag split across chunks were already consumed into
      // outsideBuf, so we only carry in messageCarry if buf had untouched
      // suffix — which it doesn't here (chunkEnd = buf.length). Nothing to do.
      return;
    }
    messageState = "inside";
    buf = buf.slice(idx + THINK_OPEN.length);
  }
}

function flushMessageStateAtTurnEnd() {
  if (lastSessionId) flushOutside(lastSessionId, true);
  messageState = "inside";
  messageCarry = "";
  outsideBuf = "";
  lastThoughtText = "";
}

function pickAllowOption(options) {
  if (!Array.isArray(options)) return null;
  const allow =
    options.find((o) => o?.kind === "allow_always") ??
    options.find((o) => o?.kind === "allow_once");
  return allow?.optionId ?? options[0]?.optionId ?? null;
}

// ── stdout handler ────────────────────────────────────────────────────────

function handleLine(line) {
  if (TRACE) process.stderr.write(`[bob→shim] ${line}\n`);
  let f;
  try {
    f = JSON.parse(line);
  } catch {
    return passthrough(line);
  }

  // Agent→client RPC requests from bob: { id, method, params } with no result/error.
  const isAgentRequest = f.id !== undefined && typeof f.method === "string";

  if (isAgentRequest && f.method === "session/request_permission") {
    const sid = f.params?.sessionId;
    // Surface the embedded toolCall so platform UI shows a chip. Don't synthesize
    // a completed update — bob emits its own tool_call_update once the op
    // actually finishes, which keeps the chip honest on failures.
    emitToolCallOpen(sid, f.params?.toolCall);
    const optionId = pickAllowOption(f.params?.options);
    sendToBob({
      jsonrpc: "2.0",
      id: f.id,
      result: optionId
        ? { outcome: { outcome: "selected", optionId } }
        : { outcome: { outcome: "cancelled" } },
    });
    return;
  }

  if (isAgentRequest && f.method.startsWith("fs/")) {
    dispatchFsRequest(f);
    return;
  }

  // Reset streaming state at turn boundary (session/prompt reply).
  if (f.id !== undefined && f.result?.stopReason) {
    flushMessageStateAtTurnEnd();
    return passthrough(line);
  }

  if (f.method !== "session/update" || !f.params?.update) return passthrough(line);

  const { sessionId, update: u } = f.params;

  switch (u.sessionUpdate) {
    case "agent_message_chunk": {
      const text = u.content?.text;
      if (typeof text !== "string") return;
      processMessageChunk(sessionId, text);
      return;
    }

    case "agent_thought_chunk": {
      const text = u.content?.text;
      if (typeof text !== "string") return passthrough(line);
      lastSessionId = sessionId;
      const delta = text.startsWith(lastThoughtText)
        ? text.slice(lastThoughtText.length)
        : text;
      lastThoughtText = text;
      if (delta) emitThoughtChunk(sessionId, delta);
      return;
    }

    case "tool_call": {
      if (u.kind === "think") {
        thinkToolCallIds.add(u.toolCallId);
        return;
      }
      return passthrough(line);
    }

    case "tool_call_update": {
      if (!thinkToolCallIds.has(u.toolCallId)) return passthrough(line);
      if (u.status !== "completed") return;
      for (const part of u.content ?? []) {
        const inner = part?.content;
        if (inner?.type === "text" && typeof inner.text === "string" && inner.text.length > 0) {
          emitAgentMessage(sessionId, inner.text);
        }
      }
      thinkToolCallIds.delete(u.toolCallId);
      return;
    }

    default:
      return passthrough(line);
  }
}
