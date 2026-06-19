import { password } from "@clack/prompts";

export function promptSecret(message: string): Promise<string | symbol> {
  return password({
    message,
    validate(v) {
      if (!v || v.trim() === "") return "Required";
      return undefined;
    },
  });
}
