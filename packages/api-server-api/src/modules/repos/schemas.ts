import { z } from "zod";

/** A curated, public git repo an agent's working directory can be seeded from.
 *  Operator-configurable via helm `gitRepos` → ConfigMap → loaded at boot. The
 *  same shape flows through helm values, the rendered ConfigMap, and these types. */
export const repoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** HTTPS clone URL (".git" form). Cloned into the work dir at first run. */
  url: z.url(),
  /** Branch or tag to clone; omitted = the repo's default branch. */
  ref: z.string().min(1).optional(),
  description: z.string().optional(),
  /** Template ids this repo is compatible with; the UI filters by the chosen
   *  harness. Empty means "offered for no harness". */
  compatibleTemplates: z.array(z.string()).default([]),
});
