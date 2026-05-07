import { zContentBlock } from "@agentclientprotocol/sdk/dist/schema/zod.gen.js";
import { z } from "zod";
import { t } from "../../trpc.js";

export const promptsRouter = t.router({
  send: t.procedure
    .input(z.object({
      instanceId: z.string().min(1),
      sessionId: z.string().min(1),
      // Validate each block against the ACP `ContentBlock` schema rather
      // than `z.unknown()` — defense-in-depth against arbitrary garbage
      // reaching the wrapper / agent. The wrapper revalidates downstream
      // anyway, but rejecting at the API edge fails loud + fast.
      prompt: z.array(zContentBlock).min(1),
      promptId: z.string().uuid(),
    }))
    .mutation(({ ctx, input }) => ctx.prompts.send(input)),
});
