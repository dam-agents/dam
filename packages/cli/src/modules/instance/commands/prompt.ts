import { createInterface } from "node:readline/promises";

/** Idle window before a hanging confirm prompt aborts. The default is
 *  No, so a forgotten `dam instance delete` in a pipeline doesn't sit
 *  forever holding stdin. */
const PROMPT_TIMEOUT_MS = 30_000;

/**
 * Yes/No confirmation read from stdin, prompt written to stderr so the
 * stdout stream stays clean for piping. Default = No. Case-insensitive
 * `y` / `yes` accepts. The `(y/N): ` suffix is appended here so every
 * destructive verb shares the same prompt shape.
 *
 * If no input arrives within `PROMPT_TIMEOUT_MS`, the prompt aborts and
 * resolves to `false` (the safe default for destructive verbs). A note
 * is written to stderr so scripted callers can see why the action was
 * declined.
 */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROMPT_TIMEOUT_MS);
  try {
    const answer = await rl.question(`${question} (y/N): `, { signal: ac.signal });
    return /^y(es)?$/i.test(answer.trim());
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") {
      process.stderr.write(
        `\n(no response within ${PROMPT_TIMEOUT_MS / 1000}s — assuming No)\n`,
      );
      return false;
    }
    throw e;
  } finally {
    clearTimeout(timer);
    rl.close();
  }
}
