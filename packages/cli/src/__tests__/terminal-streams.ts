import { PassThrough } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

export type FakeStdin = NodeJS.ReadStream & {
  setRawMode?(mode: boolean): void;
};
export type FakeStdout = NodeJS.WriteStream & { captured(): string };

export function fakeStdin(): FakeStdin {
  return Object.assign(new PassThrough(), {
    setRawMode: () => {},
  }) as unknown as FakeStdin;
}

export function fakeStdout(): FakeStdout {
  const chunks: Buffer[] = [];
  const stream = new PassThrough() as unknown as FakeStdout;
  stream.columns = 80;
  stream.rows = 24;
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.captured = () => Buffer.concat(chunks).toString("utf8");
  return stream;
}

export function listenTerminal(
  onConnection: (ws: WebSocket, url: string) => void,
): { wss: WebSocketServer; url: string } {
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", (ws, req) => onConnection(ws, req.url ?? ""));
  const { port } = wss.address() as { port: number };
  return { wss, url: `ws://127.0.0.1:${port}` };
}
