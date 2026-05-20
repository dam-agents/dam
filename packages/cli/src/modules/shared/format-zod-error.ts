import type { ZodError } from "zod";

export function formatZodError(err: ZodError): string {
  return err.issues
    .map((issue) => {
      const path = formatPath(issue.path);
      const message = issue.message.replace(/\s+/g, " ").trim();
      return path ? `  ${path}: ${message}` : `  ${message}`;
    })
    .join("\n");
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
