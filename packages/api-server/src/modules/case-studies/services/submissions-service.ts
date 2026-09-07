import { TRPCError } from "@trpc/server";
import type { CaseStudyEdition, CaseStudySubmitInput } from "api-server-api";
import {
  editionWeekStartOf,
  resolveDraft,
  toEdition,
} from "../domain/editions.js";
import type { CaseStudiesRepository } from "../infrastructure/case-studies-repository.js";

export interface CaseStudySubmissionReceipt {
  id: string;
  editionWeekStart: string;
  status: "pending";
}

export interface CaseStudySubmissionsService {
  submit(
    agentId: string,
    input: CaseStudySubmitInput,
    harnessImage: string | null,
  ): Promise<CaseStudySubmissionReceipt>;
  baseline(
    agentId: string,
    readArtifactText: (artifactId: string) => Promise<string | null>,
  ): Promise<CaseStudyEdition | null>;
}

export function createCaseStudySubmissions(deps: {
  repo: CaseStudiesRepository;
  now: () => Date;
}): CaseStudySubmissionsService {
  return {
    async submit(agentId, input, harnessImage) {
      if (input.window_start > input.window_end) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "window_start is after window_end",
        });
      }
      const record = await deps.repo.upsertEdition({
        agentId,
        editionWeekStart: editionWeekStartOf(deps.now()),
        windowStart: input.window_start,
        windowEnd: input.window_end,
        content: input.content,
        harnessImage,
        artifactId: input.artifact_id ?? null,
      });
      return {
        id: record.id,
        editionWeekStart: record.editionWeekStart,
        status: "pending",
      };
    },

    async baseline(agentId, readArtifactText) {
      const thisWeek = editionWeekStartOf(deps.now());
      const records = await deps.repo.listByAgents([agentId]);
      const record = records.find(
        (r) =>
          r.editionWeekStart < thisWeek &&
          (r.status === "pending" || r.status === "released"),
      );
      if (!record) return null;
      return toEdition(record, await resolveDraft(record, readArtifactText));
    },
  };
}
