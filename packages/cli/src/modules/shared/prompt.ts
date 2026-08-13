import { createInterface } from "node:readline/promises";
import { EXIT_SUCCESS } from "./exit-codes.js";

const DEFAULT_PROMPT_TIMEOUT_MS = 30_000;

export async function confirm(
  question: string,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const answer = await rl.question(`${question} (y/N): `, {
      signal: ac.signal,
    });
    return /^y(es)?$/i.test(answer.trim());
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") {
      process.stderr.write(
        `\n(no response within ${timeoutMs / 1000}s — assuming No)\n`,
      );
      return false;
    }
    throw e;
  } finally {
    clearTimeout(timer);
    rl.close();
  }
}

export function exitCancelled(opts: { json?: boolean }): never {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ cancelled: true })}\n`);
  } else {
    process.stdout.write("Cancelled.\n");
  }
  process.exit(EXIT_SUCCESS);
}
