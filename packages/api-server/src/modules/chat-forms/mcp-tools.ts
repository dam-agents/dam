import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  checkChatForm,
  type ChatFormPreferences,
} from "api-server-api/chat-forms";
import { json } from "../../core/mcp-tool-result.js";

export const MAX_CHAT_FORM_CHECKS = 3;

const FALLBACK =
  "Do not send this form. Ask the user in plain text instead, without an <a2ui-json> block.";

export function registerChatFormTools(
  server: McpServer,
  preferences: ChatFormPreferences,
): void {
  server.tool(
    "check_chat_form",
    `Check an A2UI chat form before you send it to the user's web chat. Pass the reply text with its <a2ui-json> blocks, or the JSON of one block, and the attempt number: 1 for the first check of a form, one more after each failed check. Returns ok, or the problems the chat would report, including forms that go against the user's chat form preferences. A surface the reply updates without creating is taken to come from an earlier reply, and only the shape of its components is checked. Fix every problem and check again. If attempt ${MAX_CHAT_FORM_CHECKS} fails, do not send the form: ask the user in plain text instead.`,
    {
      reply: z
        .string()
        .min(1)
        .max(200_000)
        .describe("The reply text with its <a2ui-json> blocks."),
      attempt: z
        .number()
        .int()
        .min(1)
        .max(
          MAX_CHAT_FORM_CHECKS,
          `At most ${MAX_CHAT_FORM_CHECKS} checks per form. ${FALLBACK}`,
        )
        .describe(
          `1 for the first check of a form, one more after each failed check; at most ${MAX_CHAT_FORM_CHECKS}.`,
        ),
    },
    ({ reply, attempt }) => {
      const result = checkChatForm(reply, preferences);
      if (result.ok) return json(result);
      return json({
        ...result,
        next:
          attempt >= MAX_CHAT_FORM_CHECKS
            ? FALLBACK
            : `Fix every problem, then call check_chat_form again with attempt ${attempt + 1}.`,
      });
    },
  );
}
