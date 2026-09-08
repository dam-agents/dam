import type { z } from "zod";
import type {
  caseStudyContentSourceSchema,
  caseStudyInspectionFilterSchema,
  caseStudyStatusSchema,
  caseStudySubmitInputSchema,
} from "./schemas.js";

export type CaseStudyStatus = z.infer<typeof caseStudyStatusSchema>;

export type CaseStudyContentSource = z.infer<
  typeof caseStudyContentSourceSchema
>;

export type CaseStudySubmitInput = z.infer<typeof caseStudySubmitInputSchema>;

export type CaseStudyInspectionFilterInput = z.infer<
  typeof caseStudyInspectionFilterSchema
>;

export interface CaseStudyInspectionFilter {
  since?: Date;
  weekOf?: Date;
  agentId?: string;
}

export interface CaseStudyEditionSummary {
  id: string;
  agentId: string;
  editionWeekStart: string;
  windowStart: string;
  windowEnd: string;
  status: CaseStudyStatus;
  harnessImage: string | null;
  artifactId: string | null;
  contentChars: number;
  contentSource: CaseStudyContentSource;
  createdAt: string;
  updatedAt: string;
}

export interface CaseStudyEdition extends CaseStudyEditionSummary {
  content: string;
}

export interface CaseStudiesService {
  list(): Promise<CaseStudyEditionSummary[]>;
  get(id: string): Promise<CaseStudyEdition>;
  release(id: string): Promise<CaseStudyEditionSummary>;
}
