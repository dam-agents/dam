import { z } from "zod";
import { ENV_NAME_RE, QUERY_PARAM_RE } from "./types.js";

// Browser-safe Zod schemas for the secrets module. Lives in its own
// file so UI code can import these without dragging in @trpc/server
// transitively via router.ts.

export const secretTypeSchema = z.enum([
  "anthropic",
  "ibm-litellm",
  "openai",
  "bob",
  "generic",
]);

/**
 * Reusable hostPattern field. Rejects wildcard patterns (`*`) because the
 * agent network gateway (Envoy) cannot route them and the pod would crash-loop.
 */
export const hostPatternSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((v) => !v.includes("*"), {
    message:
      "Wildcard host patterns are not supported. Please specify exact hostnames.",
  });

export const envMappingSchema = z.object({
  envName: z
    .string()
    .min(1)
    .max(255)
    .regex(ENV_NAME_RE, "envName must match [A-Z_][A-Z0-9_]*"),
  placeholder: z.string().min(1).max(1000),
});

export const envMappingsSchema = z.array(envMappingSchema).max(32);

export const injectionConfigSchema = z.object({
  headerName: z.string().min(1).max(255),
  valueFormat: z.string().max(1000).optional(),
  // RFC 3986 unreserved + a handful of reserved sub-delims that survive
  // unencoded query keys. Locks out characters that would either need
  // percent-encoding or break the Lua splitter's `&` / `=` framing.
  queryParamName: z
    .string()
    .min(1)
    .max(128)
    .regex(
      QUERY_PARAM_RE,
      "queryParamName must be URL-safe (A-Z a-z 0-9 . _ ~ -)",
    )
    .optional(),
});

export const updateSecretInputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(100).optional(),
    value: z.string().min(1).optional(),
    hostPattern: hostPatternSchema.optional(),
    pathPattern: z.string().max(1000).nullable().optional(),
    injectionConfig: injectionConfigSchema.nullable().optional(),
    envMappings: envMappingsSchema.optional(),
  })
  .superRefine((d, ctx) => {
    // The raw token is stored only inside the SDS file's `inline_string`
    // pre-baked with the current `valueFormat`. Changing `injectionConfig`
    // alone would leave that file out of sync with the new format, so we
    // require callers to re-supply `value` and re-bake atomically. `null`
    // (clear-to-defaults) counts as a change too — defaults aren't always
    // identical to what was stored.
    if (d.injectionConfig !== undefined && d.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "value is required when changing injectionConfig",
        path: ["value"],
      });
    }
  });
