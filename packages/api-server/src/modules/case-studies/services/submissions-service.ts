import { TRPCError } from "@trpc/server";
import type { CaseStudySubmitInput } from "api-server-api";
import { editionWeekStartOf } from "../domain/editions.js";
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
  };
}
