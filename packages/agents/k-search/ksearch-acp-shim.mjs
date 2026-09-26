#!/usr/bin/env node
import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

const sessions = new Map();

function emit(client, sessionId, text) {
  return client.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  });
}

function newSession() {
  const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  sessions.set(sessionId, { child: null });
  return { sessionId };
}

function cancel(params) {
  sessions.get(params.sessionId)?.child?.kill("SIGTERM");
}

async function prompt(params, client) {
  const session = sessions.get(params.sessionId);
  if (!session) throw new Error(`Session ${params.sessionId} not found`);

  const mode = process.env.KSEARCH_EVAL_MODE || "modal";
  await emit(
    client,
    params.sessionId,
    `Starting K-Search kernel optimization (eval backend: ${mode})…\n`,
  );

  let tail = Promise.resolve();
  const enqueue = (text) => {
    tail = tail.then(() => emit(client, params.sessionId, text)).catch(() => {});
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
  await emit(
    client,
    params.sessionId,
    `\nK-Search finished with exit code ${exitCode}.\n`,
  );
  return { stopReason: "end_turn" };
}

acp
  .agent({ name: "ksearch-acp-shim" })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
  }))
  .onRequest(acp.methods.agent.authenticate, () => ({}))
  .onRequest(acp.methods.agent.session.new, () => newSession())
  .onRequest(acp.methods.agent.session.setMode, () => ({}))
  .onRequest(acp.methods.agent.session.prompt, (ctx) =>
    prompt(ctx.params, ctx.client),
  )
  .onNotification(acp.methods.agent.session.cancel, (ctx) => cancel(ctx.params))
  .connect(
    acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
  );
