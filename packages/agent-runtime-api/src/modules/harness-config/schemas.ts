import { z } from "zod";

export const harnessConfigNoticeSchema = z.object({
  topic: z.literal("models"),
});
