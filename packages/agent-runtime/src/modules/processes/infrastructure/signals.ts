export interface ProcessSignals {
  send(pid: number, signal: NodeJS.Signals): void;
}

export function createProcessSignals(): ProcessSignals {
  return {
    send(pid, signal) {
      try {
        process.kill(pid, signal);
      } catch {
        return;
      }
    },
  };
}
