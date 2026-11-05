import { z } from "zod";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what an install answers on an assistant's own
 * harness path about the CLI it serves — the version of the bundle, which is
 * the CLI of the commit this server was built from, and the server's own
 * version, so `dam version` inside an assistant reports the install rather
 * than whichever release the machine happens to hold.
 */
export const cliVersionResponseSchema = z.object({
  cliVersion: z.string().min(1).optional(),
  serverVersion: z.string().min(1),
});

export type CliVersionResponse = z.infer<typeof cliVersionResponseSchema>;
