import { z } from "zod";

export const authConfigSchema = z.object({
  issuer: z.string().url(),
  clientId: z.string(),
  cliClientId: z.string(),
  inspectorRole: z.string().optional(),
});

export type AuthConfig = z.infer<typeof authConfigSchema>;
