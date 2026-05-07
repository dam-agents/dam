/**
 * Per-session PTY manager with server-side screen buffer.
 *
 * Each terminal session gets its own PTY process AND a headless xterm instance
 * that maintains the screen buffer server-side. When a client reconnects, the
 * current screen state is serialized and replayed, giving the client the full
 * terminal view immediately — like reattaching to tmux/screen.
 */

import headlessPkg from "@xterm/headless";
const { Terminal: HeadlessTerminal } = headlessPkg;
import serializePkg from "@xterm/addon-serialize";
const { SerializeAddon } = serializePkg;
import * as nodePty from "node-pty";
import type { WebSocket as WsWebSocket } from "ws";
import {
  OP_INPUT,
  OP_OUTPUT,
  OP_RESIZE,
  OP_EXIT,
  encodeDataFrame,
  encodeExit,
  type TerminalFrame,
} from "api-server-api";

const DETACH_GRACE_MS = 30_000;

export interface PtyManagerOptions {
  command: string[];
  workingDir: string;
  env?: Record<string, string | undefined>;
  log?: (msg: string) => void;
}

export interface PtyManager {
  attach(sessionId: string, ws: WsWebSocket): void;
  activeCount(): number;
  shutdown(): void;
}

interface PtySlot {
  pty: nodePty.IPty | null;
  /** Headless terminal that mirrors PTY output — the source of truth for
   *  screen state when a client reconnects. */
  headless: InstanceType<typeof HeadlessTerminal>;
  serialize: InstanceType<typeof SerializeAddon>;
  client: WsWebSocket | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

export function createPtyManager(opts: PtyManagerOptions): PtyManager {
  const log = opts.log ?? (() => {});
  const slots = new Map<string, PtySlot>();

  function createSlot(cols: number, rows: number): PtySlot {
    const headless = new HeadlessTerminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
    const serialize = new SerializeAddon();
    headless.loadAddon(serialize);
    return { pty: null, headless, serialize, client: null, graceTimer: null };
  }

  function getOrCreateSlot(sessionId: string, cols: number, rows: number): PtySlot {
    let slot = slots.get(sessionId);
    if (!slot) {
      slot = createSlot(cols, rows);
      slots.set(sessionId, slot);
    }
    return slot;
  }

  function clearGrace(slot: PtySlot): void {
    if (slot.graceTimer) {
      clearTimeout(slot.graceTimer);
      slot.graceTimer = null;
    }
  }

  function killSlot(sessionId: string): void {
    const slot = slots.get(sessionId);
    if (!slot) return;
    clearGrace(slot);
    if (slot.pty) {
      try { slot.pty.kill(); } catch {}
      slot.pty = null;
    }
    slot.headless.dispose();
    slots.delete(sessionId);
    log(`[${sessionId}] PTY killed`);
  }

  function spawnPty(cols: number, rows: number): nodePty.IPty {
    const cmd = opts.command[0]!;
    const args = opts.command.slice(1);

    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith("npm_config_") || k.startsWith("npm_lifecycle_")) continue;
      if (v !== undefined) cleanEnv[k] = v;
    }
    if (opts.env) {
      for (const [k, v] of Object.entries(opts.env)) {
        if (v !== undefined) cleanEnv[k] = v;
        else delete cleanEnv[k];
      }
    }
    cleanEnv.TERM = "xterm-256color";
    cleanEnv.COLORTERM = "truecolor";

    return nodePty.spawn(cmd, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: opts.workingDir,
      env: cleanEnv,
    });
  }

  function wirePty(sessionId: string, slot: PtySlot, p: nodePty.IPty): void {
    p.onData((data: string) => {
      // Feed into the headless terminal so it tracks screen state
      slot.headless.write(data);

      // Forward to the live client if connected
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

  function decodeClientFrame(data: Buffer): TerminalFrame | null {
    if (data.byteLength === 0) return null;
    const buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const op = buf[0];
    const payload = buf.subarray(1);

    switch (op) {
      case OP_INPUT:
        return { op, data: payload };
      case OP_RESIZE: {
        if (payload.byteLength < 4) return null;
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        return { op, cols: view.getUint16(0), rows: view.getUint16(2) };
      }
      default:
        return null;
    }
  }

  /** Serialize the headless terminal's screen and send it to the client as
   *  a single OUTPUT frame. The client's terminal emulator parses the ANSI
   *  sequences and rebuilds the exact screen state. */
  function replayBuffer(sessionId: string, slot: PtySlot, ws: WsWebSocket): void {
    try {
      const serialized = slot.serialize.serialize();
      log(`[${sessionId}] Replay buffer: ${serialized.length} chars`);
      if (serialized.length > 0) {
        ws.send(encodeDataFrame(OP_OUTPUT, serialized));
      }
    } catch (err) {
      log(`[${sessionId}] Replay failed: ${(err as Error).message}`);
    }
  }

  function attach(sessionId: string, ws: WsWebSocket): void {
    // The first resize frame from the client tells us the terminal size.
    // We need it before we can create the slot or spawn the PTY, so we
    // handle the first message specially.
    let initialized = false;

    ws.binaryType = "nodebuffer";

    ws.on("message", (raw: Buffer) => {
      const frame = decodeClientFrame(raw);
      if (!frame) return;

      // Wait for the first RESIZE to know the client's terminal size
      if (!initialized && frame.op === OP_RESIZE) {
        initialized = true;
        const { cols, rows } = frame;

        const existing = slots.get(sessionId);
        if (existing) {
          // Reconnecting to an existing session
          clearGrace(existing);
          if (existing.client && existing.client !== ws && existing.client.readyState === 1) {
            log(`[${sessionId}] Replacing existing client`);
            existing.client.close(1000, "replaced by new connection");
          }
          existing.client = ws;

          // Resize headless terminal + PTY to match new client
          existing.headless.resize(cols, rows);
          if (existing.pty) {
            existing.pty.resize(cols, rows);
          }

          // Replay the buffered screen state
          log(`[${sessionId}] Reconnect — replaying buffer`);
          replayBuffer(sessionId, existing, ws);
          wireClose(sessionId, existing, ws);
          return;
        }

        // New session — create slot and spawn PTY
        const slot = getOrCreateSlot(sessionId, cols, rows);
        slot.client = ws;
        slot.pty = spawnPty(cols, rows);
        wirePty(sessionId, slot, slot.pty);
        wireClose(sessionId, slot, ws);
        log(`[${sessionId}] Spawned PTY (${cols}x${rows})`);
        return;
      }

      // Regular messages after initialization
      const slot = slots.get(sessionId);
      if (!slot) return;

      switch (frame.op) {
        case OP_INPUT: {
          if (slot.pty) {
            slot.pty.write(new TextDecoder().decode(frame.data));
          }
          break;
        }
        case OP_RESIZE: {
          slot.headless.resize(frame.cols, frame.rows);
          if (slot.pty) {
            slot.pty.resize(frame.cols, frame.rows);
          }
          break;
        }
      }
    });

    // Handle early close (before first resize)
    ws.on("close", () => {
      if (!initialized) return;
    });
    ws.on("error", () => {});
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

  return {
    attach,
    activeCount: () => {
      let n = 0;
      for (const slot of slots.values()) if (slot.pty) n++;
      return n;
    },
    shutdown: () => {
      for (const sid of [...slots.keys()]) killSlot(sid);
    },
  };
}
