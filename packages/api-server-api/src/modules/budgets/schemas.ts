import { z } from "zod";

export const storageFullSchema = z.object({
  usedBytes: z.number().nonnegative(),
  usableBytes: z.number().nonnegative(),
  percent: z.number().int().min(0),
});
