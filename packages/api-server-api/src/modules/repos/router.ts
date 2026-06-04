import { t } from "../../trpc.js";
import type { Repo, RepoView } from "./types.js";

function toView(repo: Repo): RepoView {
  // Strip a trailing ".git" so the link points at the repo's web page, which
  // GitHub renders with the README inline.
  return { ...repo, readmeUrl: repo.url.replace(/\.git$/, "") };
}

export const reposRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    const repos = await ctx.repos.list();
    return repos.map(toView);
  }),
});
