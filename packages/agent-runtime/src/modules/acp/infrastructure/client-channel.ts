export interface ClientChannel {
  send(line: string): void;
  close(code?: number, reason?: string): void;
  isOpen(): boolean;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
}
