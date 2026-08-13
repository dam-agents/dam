import type {
  SpawnInvocationInput,
  SpawnInvocationResult,
} from "mock-agent-api";
import type { JsonRpcFrame } from "../domain/frames.js";

export interface AcpChannel {
  send(frame: JsonRpcFrame): void;
  onLine(handler: (line: string) => void): void;
}

export interface WorkspaceWriter {
  writeFile(relPath: string, content: string): Promise<void>;
}

export interface SlackReplyPoster {
  (args: { text: string; threadTs?: string }): Promise<void>;
}

export interface HarnessSpawn {
  (input: SpawnInvocationInput): Promise<SpawnInvocationResult>;
}

export interface ProcessRunner {
  run(args: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    timeoutMs: number;
  }): Promise<{ code: number; output: string }>;
  spawnDetached(args: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    logPath: string;
  }): void;
}
