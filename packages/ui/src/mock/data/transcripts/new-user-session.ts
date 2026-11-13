import type { Message } from "../../../types.js";
import { msg } from "./helpers.js";

export function newUserSessionTranscript(): Message[] {
  return [
    msg("nu-m1", "assistant", [
      {
        kind: "text",
        text: "Hi Jenna! I'm Chester, your new Personal DAM agent! \n\nThe more I know about you, the more I can help. Tell me a bit about your role and what you're working on, and I'll make some suggestions!\n\nWant me to catch up faster? Pick a few Slack channels for me to read, and I'll confirm with you what I've learned about you. I only read, I never post as you, and you can change this anytime.",
      },
    ]),
  ];
}
