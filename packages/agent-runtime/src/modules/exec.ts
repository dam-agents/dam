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
// point, not a new trust boundary. Speaks the terminal frame protocol; signals
// are reported as exit code 128+signum.

export function attachExec(
  ws: WsWebSocket,
  {
    argv,
    cols,
    rows,
    cwd,
    env,
    log,
  }: {
    argv: string[];
    cols: number;
    rows: number;
    cwd: string;
    env: NodeJS.ProcessEnv;
    log: (msg: string) => void;
  },
): void {
  ws.binaryType = "nodebuffer";

  let pty: nodePty.IPty;
  try {
    pty = nodePty.spawn(argv[0]!, argv.slice(1), {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: env as Record<string, string>,
    });
  } catch (e) {
    log(`spawn failed: ${String(e)}`);
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
