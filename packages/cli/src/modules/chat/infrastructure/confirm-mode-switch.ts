import { createInterface } from "node:readline";

export function createConfirmModeSwitch(): () => Promise<boolean> {
  return () => new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write("Switch session mode\nSwitch this session to terminal mode? Files and history are preserved,\nbut any running tasks will be cancelled.\n");
    rl.question("[y/N] ", (answer) => { rl.close(); resolve(answer.trim().toLowerCase() === "y"); });
  });
}
