import * as nodePty from "@lydell/node-pty";
import type { WebSocket as WsWebSocket } from "ws";
import {
  OP_INPUT,
  OP_RESIZE,
  decodeFrame,
  encodeDataFrame,
  encodeExit,
  OP_OUTPUT,
} from "api-server-api";

// One ephemeral command per WebSocket, for `dam-run`. The api-server relay is
// the only client that can reach this (kernel NetworkPolicy admits ingress only
// from the api-server, which only dials it on a Run executor pod), and it
// forwards argv supplied by the agent itself — the agent is already trusted to
// run arbitrary code in its own sandbox, so executing argv verbatim is the
// point, not a new trust boundary.
//
// The command runs in a PTY and speaks the same frame protocol as the terminal
// endpoint, so stdio streams back as if run locally; the exit code (0-255;
// signals reported as 128+signum) is relayed so `dam-run` exits with it.

export interface ExecOptions {
  argv: string[];
  cols: number;
  rows: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: (msg: string) => void;
}

export function attachExec(ws: WsWebSocket, opts: ExecOptions): void {
  ws.binaryType = "nodebuffer";
  const { argv, cwd, env } = opts;

  let pty: nodePty.IPty;
  try {
    pty = nodePty.spawn(argv[0]!, argv.slice(1), {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd,
      env: env as Record<string, string>,
    });
  } catch (e) {
    opts.log(`spawn failed: ${String(e)}`);
    if (ws.readyState === 1) {
      ws.send(
        encodeDataFrame(
          OP_OUTPUT,
          `dam-run: ${argv[0]}: ${(e as Error).message ?? String(e)}\n`,
        ),
      );
      ws.send(encodeExit(127));
      try {
        ws.close(1000, "spawn failed");
      } catch {}
    }
    return;
  }

  pty.onData((d) => {
    if (ws.readyState === 1) ws.send(encodeDataFrame(OP_OUTPUT, d));
  });
  pty.onExit(({ exitCode, signal }) => {
    if (ws.readyState === 1) {
      ws.send(encodeExit(exitCode || (signal ? 128 + signal : 0)));
      try {
        ws.close(1000, "exec exited");
      } catch {}
    }
  });

  ws.on("message", (raw: Buffer) => {
    let f;
    try {
      f = decodeFrame(raw);
    } catch {
      return;
    }
    if (f.op === OP_INPUT) pty.write(new TextDecoder().decode(f.data));
    else if (f.op === OP_RESIZE) {
      try {
        pty.resize(f.cols, f.rows);
      } catch {}
    }
  });

  const kill = () => {
    try {
      pty.kill();
    } catch {}
  };
  ws.on("close", kill);
  ws.on("error", kill);
}
