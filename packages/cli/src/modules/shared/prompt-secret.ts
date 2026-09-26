import { type CANCEL_SYMBOL, password } from "@clack/prompts";

export function promptSecret(
  message: string,
): Promise<string | typeof CANCEL_SYMBOL> {
  return password({
    message,
    validate(v) {
      if (!v || v.trim() === "") return "Required";
      return undefined;
    },
  });
}
