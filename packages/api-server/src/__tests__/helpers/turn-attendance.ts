import type { ChannelTurnAttendance } from "../../core/turn-attendance.js";

/** Inert channel-turn attendance for the many worker tests that don't exercise
 *  the egress gate. Passed explicitly rather than defaulted on the worker: the
 *  real dependency is required there, so a dropped wiring is a type error
 *  instead of a silently reinstated approval stall. Tests that assert on the
 *  marker build their own recording stub. */
export function stubTurnAttendance(): ChannelTurnAttendance {
  return { openChannelTurn: () => () => {} };
}
