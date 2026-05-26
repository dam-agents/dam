import { z } from "zod";

export const secretRef = z.object({
  storeId: z.string().optional(),

  path: z.string().min(1),

  field: z.string().min(1),
});

export type SecretRef = z.infer<typeof secretRef>;
