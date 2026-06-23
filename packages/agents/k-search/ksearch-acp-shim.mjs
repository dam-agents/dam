#!/usr/bin/env node
// Minimal ACP agent that fronts the K-Search batch job.
//
// agent-runtime spawns harness-chat as a long-lived ACP subprocess at boot and
// crashes if it exits. K-Search is not an interactive LLM agent, so this shim
// implements just enough ACP (initialize / session/new / session/prompt) to
// stay alive and, on a prompt, run `ksearch-run` and stream its output back as
// agent message chunks. The prompt text is ignored for now — the run is driven
// by the KSEARCH_* env (see ksearch-run).
import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

class KSearchAgent {
  constructor(connection) {
    this.connection = connection;
    this.sessions = new Map();
    // Serialize sessionUpdate writes so streamed chunks keep their order.
    this.tail = Promise.resolve();
  }

  send(sessionId, text) {
    this.tail = this.tail.then(() =>
      this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      }),
    );
    return this.tail;
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
    await this.send(
      params.sessionId,
      `Starting K-Search kernel optimization (eval backend: ${mode})…\n`,
    );

    const exitCode = await new Promise((resolve) => {
      const child = spawn("ksearch-run", [], { env: process.env });
      session.child = child;
      const relay = (chunk) => this.send(params.sessionId, chunk.toString());
      child.stdout.on("data", relay);
      child.stderr.on("data", relay);
      child.on("error", (e) => {
        this.send(params.sessionId, `ksearch-run failed to start: ${e.message}\n`);
        resolve(1);
      });
      child.on("close", (code) => resolve(code ?? 0));
    });

    session.child = null;
    await this.send(
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
