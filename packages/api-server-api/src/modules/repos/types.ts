import type { z } from "zod";
import type { repoSchema } from "./schemas.js";

export type Repo = z.infer<typeof repoSchema>;

/** The repo as served to the UI: the registry entry plus a derived web URL
 *  pointing at the repo's README (GitHub renders the README at the repo root). */
export interface RepoView extends Repo {
  readmeUrl: string;
}

export interface ReposService {
  list: () => Promise<Repo[]>;
}
