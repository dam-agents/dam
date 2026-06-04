import { z } from "zod";

/** A curated, public git repo an agent's working directory can be seeded from.
 *  Chart-shipped config (helm values → ConfigMap), so the same shape flows
 *  through helm values, the rendered ConfigMap, and these types. */
export const repoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** HTTPS clone URL (".git" form). Cloned into the working dir at first run. */
  url: z.url(),
  description: z.string().optional(),
  /** Template ids this repo is compatible with; the UI filters by the chosen
   *  harness. Empty means "show for none". */
  compatibleTemplates: z.array(z.string()).default([]),
});
