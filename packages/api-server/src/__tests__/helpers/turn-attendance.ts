import type { ChannelTurnAttendance } from "../../core/turn-attendance.js";

export function stubTurnAttendance(): ChannelTurnAttendance {
  return { openChannelTurn: () => () => {} };
}
