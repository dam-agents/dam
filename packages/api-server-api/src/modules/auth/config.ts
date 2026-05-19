import { z } from "zod";

export const authConfigSchema = z.object({
  issuer: z.string().url(),
  clientId: z.string(),
  cliClientId: z.string(),
});

export type AuthConfig = z.infer<typeof authConfigSchema>;
