import { DAY_MS } from "../domain/editions.js";
import type { CaseStudiesRepository } from "../infrastructure/case-studies-repository.js";

export interface CaseStudyRetentionSweeper {
  tick(): Promise<number>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Ages editions by the week they cover, not by row
 * timestamps: a same-week resubmission rewrites the row in place (so its
 * created_at would purge the rewrite early), and a release bumps updated_at
 * (so consenting would extend retention). Purging once the week's end is older
 * than the window guarantees every submitted version lives the full window,
 * while nothing outlives its week by more than the window plus the sweep
 * interval. Retention stays the outer bound for tombstones too: a withdrawal
 * near the horizon is purged by age rather than kept the full grace.
 */
export function createCaseStudyRetentionSweeper(deps: {
  repo: CaseStudiesRepository;
  retentionDays: number;
  graceDays: number;
  now: () => Date;
}): CaseStudyRetentionSweeper {
  return {
    async tick() {
      const at = deps.now().getTime();
      const weekStartBefore = new Date(at - (deps.retentionDays + 7) * DAY_MS)
        .toISOString()
        .slice(0, 10);
      return deps.repo.purge(
        weekStartBefore,
        new Date(at - deps.graceDays * DAY_MS),
      );
    },
  };
}
