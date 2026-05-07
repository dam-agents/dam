import { z } from "zod";
import { t } from "../../trpc.js";

export const promptsRouter = t.router({
  send: t.procedure
    .input(z.object({
      instanceId: z.string().min(1),
      sessionId: z.string().min(1),
      prompt: z.array(z.unknown()).min(1),
      promptId: z.string().uuid(),
    }))
    .mutation(({ ctx, input }) => ctx.prompts.send(input)),
});
