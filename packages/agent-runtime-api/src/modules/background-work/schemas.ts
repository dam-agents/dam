import { z } from "zod/v4";

/**
 * Advisory text: clamped, never rejected. Length here is cosmetic — a real
 * background command runs long — and a rejection would fail the *whole* report,
 * losing a hold and killing the work over the size of a label. Any limit that
 * can drop a report has to be a truncation instead.
 */
const advisory = (max: number) =>
  z
    .string()
    .transform((text) => text.slice(0, max))
    .optional();

/**
 * One piece of in-flight background work a session has left running: a job
 * started with a backgrounding tool, an async task, anything that outlives the
 * turn that started it.
 *
 * `id` is the reporter's own handle for the work and only has to be stable
 * within one session. The two descriptive fields exist so a sandbox that stays
 * awake can be explained to the person paying for it; neither affects any
 * decision.
 */
export const backgroundWorkItemSchema = z.object({
  id: z
    .string()
    .min(1)
    .transform((id) => id.slice(0, 128)),
  description: advisory(200),
  command: advisory(500),
});

/**
 * A session's complete in-flight set, **as a level rather than an edge**: each
 * report replaces the last one, and an empty `items` means "nothing of mine is
 * running any more".
 *
 * Levels are what make the contract safe to implement from the outside. A
 * start/stop pair would need the reporter to be reliable twice — a missed stop
 * would keep a session alive forever, and a missed start would lose work — while
 * a level self-corrects on the very next report, in whichever direction it was
 * wrong. It also means a reporter never has to remember what it said before.
 */
export const backgroundWorkReportSchema = z.object({
  // Also truncated rather than capped, for the same reason: a hold is per
  // session, so one surviving item holds it, whereas rejecting an over-long list
  // would hold nothing at all. Excess entries cost only detail in the status
  // payload.
  items: z
    .array(backgroundWorkItemSchema)
    .transform((items) => items.slice(0, 64)),
});
