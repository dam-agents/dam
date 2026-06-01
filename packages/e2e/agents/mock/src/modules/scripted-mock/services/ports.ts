import type { JsonRpcFrame } from "../domain/frames.js";

export interface AcpChannel {
  send(frame: JsonRpcFrame): void;
  onLine(handler: (line: string) => void): void;
}
