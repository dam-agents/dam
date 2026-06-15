import { z } from "zod";

/**
 * Set fields are stored as sorted arrays so React Hook Form's structural
 * equality check (used for `isDirty` / `dirtyFields`) matches on content.
 * `dirtyFields.selSecrets` replaces the manual `secretsDirty` flag the
 * pre-RHF version carried for the "user-touched-secrets" semantics.
 */
const REGISTRY_FIELDS = ["server", "username", "password"] as const;

export const addAgentSchema = z
  .object({
    name: z.string().trim().min(1, "Required"),
    description: z.string().trim(),
    selSecrets: z.array(z.string()),
    selApps: z.array(z.string()),
    /** Egress preset seeded into egress_rules at create time
     *  (ADR-035). `trusted` is the recommended default. */
    egressPreset: z.enum(["none", "trusted", "all"]),
    registryCredential: z.object({
      server: z.string().trim(),
      username: z.string().trim(),
      password: z.string(),
    }),
  })
  .superRefine((data, ctx) => {
    const { server, username, password } = data.registryCredential;
    const filled = [server, username, password].filter((v) => v.length > 0);
    if (filled.length === 0 || filled.length === REGISTRY_FIELDS.length) return;
    for (const field of REGISTRY_FIELDS) {
      if (data.registryCredential[field].length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["registryCredential", field],
          message: "Required",
        });
      }
    }
  });

export type AddAgentValues = z.infer<typeof addAgentSchema>;
