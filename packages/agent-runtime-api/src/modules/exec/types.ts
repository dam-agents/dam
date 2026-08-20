export interface ExecRunResult {
  exitCode: number | null;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  cwd: string;
  durationMs: number;
}

export interface ExecStartResult {
  backgroundId: string;
}

export interface ExecTailResult {
  output: string;
  nextOffset: number;
  running: boolean;
  exitCode: number | null;
}

export interface ExecService {
  run(input: {
    command: string;
    cwd?: string;
    timeoutMs?: number;
  }): Promise<ExecRunResult>;
  start(input: { command: string; cwd?: string }): Promise<ExecStartResult>;
  tail(backgroundId: string, offset?: number): Promise<ExecTailResult | null>;
  kill(backgroundId: string): Promise<boolean>;
}
