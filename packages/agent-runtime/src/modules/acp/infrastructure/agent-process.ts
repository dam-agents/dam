/**
 * Port: the ACP-speaking child process the runtime talks to over stdio.
 * Implementations live alongside this file as factory functions.
 */
export interface AgentProcess {
  send(frame: unknown): void;
  onLine(handler: (line: string) => void): void;
  kill(): void;
  exited: Promise<void>;
  /**
   * OS pid, when the implementation has one. It roots the search for processes
   * the harness spawned — see services/background-work-tracker.ts. Absent for
   * in-process fakes, which simply get no background-work tracking.
   */
  pid?: number;
}
