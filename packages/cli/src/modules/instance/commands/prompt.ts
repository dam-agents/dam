import { createInterface } from "node:readline/promises";

/**
 * Yes/No confirmation read from stdin, prompt written to stderr so the
 * stdout stream stays clean for piping. Default = No. Case-insensitive
 * `y` / `yes` accepts. The `(y/N): ` suffix is appended here so every
 * destructive verb shares the same prompt shape.
 */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await rl.question(`${question} (y/N): `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
