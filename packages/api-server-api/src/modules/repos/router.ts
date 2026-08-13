import { t } from "../../trpc.js";
import { readAgentProcedure } from "../../auth-procedures.js";
import type { Repo, RepoView } from "./types.js";

function toView(repo: Repo): RepoView {
  return { ...repo, readmeUrl: repo.url.replace(/\.git$/, "") };
}

export const reposRouter = t.router({
  list: readAgentProcedure.query(async ({ ctx }) => {
    const repos = await ctx.repos.list();
    return repos.map(toView);
  }),
});
