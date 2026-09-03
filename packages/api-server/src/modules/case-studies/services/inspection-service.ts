import type { CaseStudyEdition, CaseStudyEditionSummary } from "api-server-api";
import {
  editionWeekStartOf,
  toEdition,
  toSummary,
} from "../domain/editions.js";
import type { CaseStudiesRepository } from "../infrastructure/case-studies-repository.js";

export interface CaseStudyInspectionFilter {
  since?: Date;
  weekOf?: Date;
  agentId?: string;
}

export interface CaseStudyInspectionService {
  list(filter: CaseStudyInspectionFilter): Promise<CaseStudyEditionSummary[]>;
  get(id: string): Promise<CaseStudyEdition | null>;
}

export function createCaseStudyInspection(deps: {
  repo: CaseStudiesRepository;
}): CaseStudyInspectionService {
  return {
    async list(filter) {
      const records = await deps.repo.listReleased({
        since: filter.since,
        weekStart: filter.weekOf
          ? editionWeekStartOf(filter.weekOf)
          : undefined,
        agentId: filter.agentId,
      });
      return records.map(toSummary);
    },

    async get(id) {
      const record = await deps.repo.getById(id);
      if (!record || record.status !== "released") return null;
      return toEdition(record);
    },
  };
}
