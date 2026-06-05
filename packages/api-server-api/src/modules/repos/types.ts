import type { z } from "zod";
import type { repoSchema } from "./schemas.js";

export type Repo = z.infer<typeof repoSchema>;

/** Repo as served to the UI: catalog entry plus a derived README web URL. */
export interface RepoView extends Repo {
  readmeUrl: string;
}

export interface ReposService {
  list: () => Promise<Repo[]>;
}
