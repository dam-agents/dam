import type { SatelliteImage, SatelliteTool } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the worker runs work against. Both ways of
 * starting a worker reduce to this: a set of tools and a way to call one. A
 * Command Surface becomes a backend offering exactly one tool, so the transport,
 * the platform and the Agent see nothing but an MCP server either way.
 */
export interface SatelliteBackend {
  readonly tools: SatelliteTool[];
  /**
   * UNIT_BOUNDARY_DESCRIPTION: The tools this backend offers now, starting the
   * MCP server behind it again if that server exited. One that is still up is
   * left alone: restarting it on every reconnect would kill whatever it was
   * running and change the tool list for no reason.
   */
  ensureReady(): Promise<{ restarted: boolean }>;
  call(input: {
    sequence: number;
    tool: string;
    args: Record<string, unknown>;
  }): Promise<CallOutcome>;
  describeCall(tool: string, args: Record<string, unknown>): string;
  cancel(sequence: number): void;
  killAll(): void;
  close(): Promise<void>;
}

export type CallOutcome =
  | {
      status: "done";
      isError: boolean;
      exitCode: number | null;
      output: string;
      images?: SatelliteImage[];
      truncated: boolean;
      blocked?: true;
    }
  | { status: "cancelled"; output: string; truncated: boolean }
  | {
      status: "interrupted";
      reason: string;
      output: string;
      truncated: boolean;
    };
