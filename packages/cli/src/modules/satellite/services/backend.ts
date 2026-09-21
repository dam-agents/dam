import type { SatelliteTool } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the worker runs work against. Both forms of
 * `dam satellite connect` reduce to this: a set of tools and a way to call one.
 * A Manifest becomes a backend offering exactly one tool, so the transport, the
 * platform and the Agent see nothing but an MCP server either way.
 */
export interface SatelliteBackend {
  readonly tools: SatelliteTool[];
  call(input: {
    sequence: number;
    tool: string;
    args: Record<string, unknown>;
    approved: boolean;
  }): Promise<CallOutcome>;
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
    }
  | { status: "cancelled"; output: string; truncated: boolean }
  | {
      status: "interrupted";
      reason: string;
      output: string;
      truncated: boolean;
    }
  | { status: "needs-approval"; reason: string };
