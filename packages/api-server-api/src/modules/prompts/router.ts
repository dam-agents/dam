import { zContentBlock } from "@agentclientprotocol/sdk/dist/schema/zod.gen.js";
import { TRPCError } from "@trpc/server";
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
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prompts.send(input);
      // Service returns null on ownership failure; router translates to
      // NOT_FOUND. Same wording as approvals' ownership-failure path so
      // callers see one consistent shape.
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "instance not found" });
      }
      return result;
    }),
});
