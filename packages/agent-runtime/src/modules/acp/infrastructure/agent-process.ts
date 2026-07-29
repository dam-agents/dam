/**
 * Port: the ACP-speaking child process the runtime talks to over stdio.
 * Implementations live alongside this file as factory functions.
 */
export interface AgentProcess {
  send(frame: unknown): void;
  onLine(handler: (line: string) => void): void;
  kill(): void;
  exited: Promise<void>;
}
