import readline from "node:readline";
import type { JsonRpcFrame } from "../domain/frames.js";
import type { AcpChannel } from "../services/ports.js";

export function createStdioChannel(): AcpChannel {
  const handlers: ((line: string) => void)[] = [];
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    for (const h of handlers) h(line);
  });
  return {
    send(frame: JsonRpcFrame) {
      process.stdout.write(JSON.stringify(frame) + "\n");
    },
    onLine(handler) {
      handlers.push(handler);
    },
  };
}
