import { z } from "zod";

export const sshAuthorizeKeyInputSchema = z.object({
  publicKey: z
    .string()
    .min(1)
    .max(8192)
    .refine((s) => !/[\r\n]/.test(s), "must be a single line"),
});
