import type { z } from "zod";

export async function parseOrExit<T>(
  schema: z.ZodType<T>,
  input: unknown,
  exitCode: number,
  onExit?: () => void | Promise<void>,
): Promise<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => {
    const path = formatPath(issue.path);
    const message = issue.message.replace(/\s+/g, " ").trim();
    return path ? `  ${path}: ${message}` : `  ${message}`;
  });
  process.stderr.write(`error: invalid input\n${issues.join("\n")}\n`);
  if (onExit) await onExit();
  process.exit(exitCode);
}

function formatPath(path: PropertyKey[]): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else {
      out += out === "" ? String(segment) : `.${String(segment)}`;
    }
  }
  return out;
}
