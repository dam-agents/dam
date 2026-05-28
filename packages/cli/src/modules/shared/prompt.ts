import { createInterface } from "node:readline/promises";

/** Default idle window before a hanging confirm prompt aborts to No. */
const DEFAULT_PROMPT_TIMEOUT_MS = 30_000;

/**
 * Yes/No confirmation read from stdin, prompt written to stderr so the
 * stdout stream stays clean for piping. Default = No. Case-insensitive
 * `y` / `yes` accepts. The `(y/N): ` suffix is appended here so every
 * destructive verb shares the same prompt shape.
 *
 * If no input arrives within `timeoutMs`, the prompt aborts and resolves
 * to `false` (the safe default for destructive verbs). A note is written
 * to stderr so scripted callers can see why the action was declined.
 *
 * Callers that want to render a preamble (e.g. a list of paths) should
 * write it to stderr themselves before calling this — the prompt is
 * intentionally just the trailing question.
 */
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
