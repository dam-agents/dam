import headlessPkg from "@xterm/headless";
const { Terminal: HeadlessTerminal } = headlessPkg;
import serializePkg from "@xterm/addon-serialize";
const { SerializeAddon } = serializePkg;
import * as nodePty from "@lydell/node-pty";
import type { WebSocket as WsWebSocket } from "ws";
import {
  OP_INPUT,
  OP_OUTPUT,
  OP_RESIZE,
  decodeFrame,
  encodeDataFrame,
  encodeExit,
} from "api-server-api";

const DETACH_GRACE_MS = 30_000;

interface PtySlot {
  pty: nodePty.IPty | null;
  headless: InstanceType<typeof HeadlessTerminal>;
  serialize: InstanceType<typeof SerializeAddon>;
  client: WsWebSocket | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

export function createPtyManager(opts: {
  command: string[];
  workingDir: string;
  env?: Record<string, string | undefined>;
  log?: (msg: string) => void;
}) {
  const log = opts.log ?? (() => {});
  const slots = new Map<string, PtySlot>();

  function killSlot(sessionId: string): void {
    const slot = slots.get(sessionId);
    if (!slot) return;
    if (slot.graceTimer) clearTimeout(slot.graceTimer);
    if (slot.pty) {
      try { slot.pty.kill(); } catch {}
    }
    slot.headless.dispose();
    slots.delete(sessionId);
    log(`[${sessionId}] PTY killed`);
  }

  function spawnPty(sessionId: string, cols: number, rows: number): nodePty.IPty {
    // Substitute {sessionId} placeholders so harnesses like claude can be told
    // to use our own UUID for their on-disk session log (e.g. `claude --session-id {sessionId}`).
    // This makes terminal-mode sessions resumable as chat without an id swap.
    const [cmd, ...args] = opts.command.map((p) => p.replaceAll("{sessionId}", sessionId));
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !k.startsWith("npm_config_") && !k.startsWith("npm_lifecycle_"))
        cleanEnv[k] = v;
    }
    if (opts.env) {
      for (const [k, v] of Object.entries(opts.env)) {
        if (v !== undefined) cleanEnv[k] = v;
        else delete cleanEnv[k];
      }
    }
    cleanEnv.TERM = "xterm-256color";
    cleanEnv.COLORTERM = "truecolor";

    return nodePty.spawn(cmd!, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: opts.workingDir,
      env: cleanEnv,
    });
  }

  function wirePty(sessionId: string, slot: PtySlot, p: nodePty.IPty): void {
    p.onData((data: string) => {
      slot.headless.write(data);
      if (slot.client?.readyState === 1) {
        slot.client.send(encodeDataFrame(OP_OUTPUT, data));
      }
    });

    p.onExit(({ exitCode }) => {
      log(`[${sessionId}] PTY exited with code ${exitCode}`);
      if (slot.client?.readyState === 1) {
        slot.client.send(encodeExit(exitCode));
        slot.client.close(1000, "pty exited");
      }
      slot.pty = null;
      slot.headless.dispose();
      slots.delete(sessionId);
    });
  }

  function wireClose(sessionId: string, slot: PtySlot, ws: WsWebSocket): void {
    ws.on("close", () => {
      if (slot.client === ws) {
        slot.client = null;
        if (slot.pty) {
          log(`[${sessionId}] Client detached — starting grace timer`);
          slot.graceTimer = setTimeout(() => {
            log(`[${sessionId}] Grace expired — killing PTY`);
            killSlot(sessionId);
          }, DETACH_GRACE_MS);
        }
      }
    });
    ws.on("error", () => {
      if (slot.client === ws) slot.client = null;
    });
  }

  function attach(sessionId: string, ws: WsWebSocket, opts?: { reset?: boolean }): void {
    if (opts?.reset) killSlot(sessionId);
    let initialized = false;
    ws.binaryType = "nodebuffer";

    ws.on("message", (raw: Buffer) => {
      let frame;
      try { frame = decodeFrame(raw); } catch { return; }

      // Wait for the first RESIZE to know the client's terminal size
      if (!initialized && frame.op === OP_RESIZE) {
        initialized = true;
        const { cols, rows } = frame;

        const existing = slots.get(sessionId);
        if (existing) {
          // Reconnecting to an existing session
          if (existing.graceTimer) clearTimeout(existing.graceTimer);
          if (existing.client && existing.client !== ws && existing.client.readyState === 1) {
            log(`[${sessionId}] Replacing existing client`);
            existing.client.close(1000, "replaced by new connection");
          }
          existing.client = ws;
          existing.headless.resize(cols, rows);
          if (existing.pty) existing.pty.resize(cols, rows);

          // Replay the buffered screen state
          log(`[${sessionId}] Reconnect — replaying buffer`);
          try {
            const serialized = existing.serialize.serialize();
            log(`[${sessionId}] Replay buffer: ${serialized.length} chars`);
            if (serialized.length > 0) ws.send(encodeDataFrame(OP_OUTPUT, serialized));
          } catch (err) {
            log(`[${sessionId}] Replay failed: ${(err as Error).message}`);
          }
          wireClose(sessionId, existing, ws);
          return;
        }

        // New session — create slot and spawn PTY
        const headless = new HeadlessTerminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
        const serialize = new SerializeAddon();
        headless.loadAddon(serialize);
        const slot: PtySlot = { pty: null, headless, serialize, client: ws, graceTimer: null };
        slots.set(sessionId, slot);
        slot.pty = spawnPty(sessionId, cols, rows);
        wirePty(sessionId, slot, slot.pty);
        wireClose(sessionId, slot, ws);
        log(`[${sessionId}] Spawned PTY (${cols}x${rows})`);
        return;
      }

      // Regular messages after initialization
      const slot = slots.get(sessionId);
      if (!slot) return;

      switch (frame.op) {
        case OP_INPUT:
          if (slot.pty) slot.pty.write(new TextDecoder().decode(frame.data));
          break;
        case OP_RESIZE:
          slot.headless.resize(frame.cols, frame.rows);
          if (slot.pty) slot.pty.resize(frame.cols, frame.rows);
          break;
      }
    });

    ws.on("close", () => { /* pre-init close — nothing to do */ });
    ws.on("error", () => {});
  }

  return {
    attach,
    activeCount: () => slots.size,
    shutdown: () => { for (const sid of [...slots.keys()]) killSlot(sid); },
  };
}
