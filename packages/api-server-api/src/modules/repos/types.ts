import type { z } from "zod";
import type { repoSchema } from "./schemas.js";

export type Repo = z.infer<typeof repoSchema>;

export interface RepoView extends Repo {
  readmeUrl: string;
}

export interface ReposService {
  list: () => Promise<Repo[]>;
}
