export interface AgentProcess {
  send(frame: unknown): void;
  onLine(handler: (line: string) => void): void;
  kill(): void;
  exited: Promise<void>;
}
