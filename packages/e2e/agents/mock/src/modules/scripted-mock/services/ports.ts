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

/** Posts the mock's reply through the platform-outbound `reply` MCP tool, the
 *  way a real harness must now that plain assistant text is not delivered to
 *  Slack. Best-effort: failures are logged, never thrown. */
export interface SlackReplyPoster {
  (args: { text: string; threadTs?: string }): Promise<void>;
}

/** Spawns an Invocation via the harness surface, as this agent (the driver). */
export interface HarnessSpawn {
  (input: SpawnInvocationInput): Promise<SpawnInvocationResult>;
}
