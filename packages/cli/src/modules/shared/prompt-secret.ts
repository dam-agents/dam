import { password } from "@clack/prompts";

/**
 * Masked prompt for a non-empty credential value. Shared by the interactive
 * setup flow and `connection update` so the "Required" validation reads the
 * same everywhere. Returns clack's `string | symbol` — callers must still
 * `isCancel`-check the result.
 */
export function promptSecret(message: string): Promise<string | symbol> {
  return password({
    message,
    validate(v) {
      if (!v || v.trim() === "") return "Required";
      return undefined;
    },
  });
}
