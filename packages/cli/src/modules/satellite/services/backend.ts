import type { SatelliteTool } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the worker runs work against. Both ways of
 * starting a worker reduce to this: a set of tools and a way to call one. A
 * Command Surface becomes a backend offering exactly one tool, so the transport,
 * the platform and the Agent see nothing but an MCP server either way.
 */
export interface SatelliteBackend {
  readonly tools: SatelliteTool[];
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
