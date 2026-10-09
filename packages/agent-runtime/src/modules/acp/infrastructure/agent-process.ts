export interface AgentProcess {
  pid: number | undefined;
  send(frame: unknown): void;
  onLine(handler: (line: string) => void): void;
  kill(): void;
  exited: Promise<void>;
}
