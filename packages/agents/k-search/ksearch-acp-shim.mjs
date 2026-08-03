#!/usr/bin/env node
// Minimal ACP agent so agent-runtime's required harness-chat subprocess stays
// alive; on a prompt it runs `ksearch-run` (driven by KSEARCH_* env) and
// streams the output back. The prompt text is ignored.
import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

class KSearchAgent {
  constructor(connection) {
    this.connection = connection;
    this.sessions = new Map();
  }

  emit(sessionId, text) {
    return this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    });
  }

  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
    };
  }

  async newSession() {
    const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    this.sessions.set(sessionId, { child: null });
    return { sessionId };
  }

  async authenticate() {
    return {};
  }

  async setSessionMode() {
    return {};
  }

  async cancel(params) {
    this.sessions.get(params.sessionId)?.child?.kill("SIGTERM");
  }

  async prompt(params) {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Session ${params.sessionId} not found`);

    const mode = process.env.KSEARCH_EVAL_MODE || "modal";
    await this.emit(
      params.sessionId,
      `Starting K-Search kernel optimization (eval backend: ${mode})…\n`,
    );

    // Serialize relayed chunks through `tail` (ordered + bounded via stream
    // pause/resume); awaited before the summary so it prints last.
    let tail = Promise.resolve();
    const enqueue = (text) => {
      tail = tail.then(() => this.emit(params.sessionId, text)).catch(() => {});
      return tail;
    };

    const exitCode = await new Promise((resolve) => {
      const child = spawn("ksearch-run", [], { env: process.env });
      session.child = child;
      const relay = (rs) => {
        rs.setEncoding("utf8");
        rs.on("data", (chunk) => {
          rs.pause();
          enqueue(chunk).finally(() => rs.resume());
        });
      };
      relay(child.stdout);
      relay(child.stderr);
      child.on("error", (e) => {
        enqueue(`ksearch-run failed to start: ${e.message}\n`);
        resolve(1);
      });
      child.on("close", (code) => resolve(code ?? 0));
    });

    session.child = null;
    await tail;
    await this.emit(
      params.sessionId,
      `\nK-Search finished with exit code ${exitCode}.\n`,
    );
    return { stopReason: "end_turn" };
  }
}

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
);
new acp.AgentSideConnection((conn) => new KSearchAgent(conn), stream);
