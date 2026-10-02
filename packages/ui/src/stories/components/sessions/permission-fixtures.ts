import { useStore } from "@/store";

import { IDS } from "../../backend/scenario";
import { resetState } from "../agents/story-helpers";
import { EXECUTE_CHIP } from "./chat-fixtures";

/** The options the Claude Code ACP adapter offers for a tool call. */
export const PERMISSION_OPTIONS = [
  { optionId: "allow_always", name: "Always Allow", kind: "allow_always" },
  { optionId: "allow", name: "Allow", kind: "allow_once" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];

/** Loader: the checkout session open, with `count` tool calls waiting for
 *  approval (the first is the transcript's last shell command). */
export function seedPendingPermissions(count = 1, title = EXECUTE_CHIP.title) {
  return () => {
    resetState();
    useStore.setState({
      selectedAgent: IDS.codingAgent,
      sessionId: IDS.session1,
      pendingPermissions: Array.from({ length: count }, (_, i) => ({
        toolCallId: `toolu_pending_${i}`,
        sessionId: IDS.session1,
        toolCall: {
          toolCallId: `toolu_pending_${i}`,
          kind: "execute",
          title: i === 0 ? title : `Edit src/pricing/tax.ts (${i})`,
          locations: i === 0 ? [] : [{ path: "/home/agent/work/src/pricing/tax.ts" }],
        },
        options: PERMISSION_OPTIONS,
        resolve: () => {},
      })),
    });
    return {};
  };
}
