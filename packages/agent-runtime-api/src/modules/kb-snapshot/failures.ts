import { z } from "zod";

export const kbPublishFailureSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("root-missing"), root: z.string() }),
  z.object({ code: z.literal("too-deep") }),
  z.object({ code: z.literal("too-many-files") }),
  z.object({ code: z.literal("total-too-large") }),
  z.object({ code: z.literal("upload-failed"), detail: z.string() }),
]);

export type KbPublishFailure = z.infer<typeof kbPublishFailureSchema>;
