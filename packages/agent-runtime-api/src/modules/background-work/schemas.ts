import { z } from "zod/v4";

/**
 * One piece of in-flight background work a session has left running: a job
 * started with a backgrounding tool, an async task, anything that outlives the
 * turn that started it.
 *
 * `id` is the reporter's own handle for the work and only has to be stable
 * within one session. The two descriptive fields exist so a sandbox that stays
 * awake can be explained to the person paying for it; neither affects any
 * decision, and both are truncated rather than trusted.
 */
export const backgroundWorkItemSchema = z.object({
  id: z.string().min(1).max(128),
  description: z.string().max(200).optional(),
  command: z.string().max(500).optional(),
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
  items: z.array(backgroundWorkItemSchema).max(64),
});
