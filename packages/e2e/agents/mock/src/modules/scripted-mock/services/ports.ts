import type { JsonRpcFrame } from "../domain/frames.js";

export interface AcpChannel {
  send(frame: JsonRpcFrame): void;
  onLine(handler: (line: string) => void): void;
}

export interface WorkspaceWriter {
  writeFile(relPath: string, content: string): Promise<void>;
}
