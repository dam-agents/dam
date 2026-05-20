import type { z } from "zod";
import { formatZodError } from "./format-zod-error.js";

export async function parseOrExit<T>(
  schema: z.ZodType<T>,
  input: unknown,
  exitCode: number,
  onExit?: () => void | Promise<void>,
): Promise<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  process.stderr.write(
    `error: invalid input\n${formatZodError(result.error)}\n`,
  );
  if (onExit) await onExit();
  process.exit(exitCode);
}
