import type { ModelMessage } from "ai";
import type { ContextMessage } from "./events.js";

export function toModelMessages(messages: ContextMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    switch (m.role) {
      case "user":
        out.push({ role: "user", content: m.text });
        break;
      case "assistant":
        out.push({ role: "assistant", content: m.text });
        break;
      case "assistant-tool-call":
        out.push({
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: m.callId,
              toolName: m.tool,
              input: m.args,
            },
          ],
        });
        break;
      case "tool-result":
        out.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: m.callId,
              toolName: m.tool,
              output: m.isError
                ? { type: "error-text", value: m.output }
                : { type: "text", value: m.output },
            },
          ],
        });
        break;
    }
  }
  return out;
}
