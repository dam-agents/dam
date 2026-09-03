import { DAY_MS } from "../domain/editions.js";
import type { CaseStudiesRepository } from "../infrastructure/case-studies-repository.js";

export interface CaseStudyRetentionSweeper {
  tick(): Promise<number>;
}

export function createCaseStudyRetentionSweeper(deps: {
  repo: CaseStudiesRepository;
  retentionDays: number;
  graceDays: number;
  now: () => Date;
}): CaseStudyRetentionSweeper {
  return {
    async tick() {
      const at = deps.now().getTime();
      return deps.repo.purge(
        new Date(at - deps.retentionDays * DAY_MS),
        new Date(at - deps.graceDays * DAY_MS),
      );
    },
  };
}
