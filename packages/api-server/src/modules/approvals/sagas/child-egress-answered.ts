import type { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type ApprovalResolved,
} from "../../../events.js";

// UNIT_BOUNDARY_DESCRIPTION: tells whoever holds work for a child's waiting network rule that the owner answered one, or that it was withdrawn: the child's id, once per answer. A one-off sub-agent's task is left out of delivery while a rule waits, and nothing else would deliver it again when the wait ends.
export function startChildEgressAnsweredSaga(
  onAnswered: (childId: string) => void,
): Subscription {
  return events$()
    .pipe(ofType<ApprovalResolved>(EventType.ApprovalResolved))
    .subscribe((event) => {
      if (event.approvalId.startsWith("egressproposal:"))
        onAnswered(event.agentId);
    });
}
