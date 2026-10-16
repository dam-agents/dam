import type { FormPart, Message } from "../../../types.js";

export function msg(
  id: string,
  role: Message["role"],
  parts: Message["parts"],
): Message {
  return { id, role, parts, streaming: false };
}

export function form(f: Omit<FormPart, "kind">): FormPart {
  return { kind: "form", ...f };
}
