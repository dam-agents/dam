import { TRPCError } from "@trpc/server";
import { caseStudyContentSchema } from "api-server-api";
import type {
  CaseStudyContentSource,
  CaseStudiesService,
} from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import {
  releaseVerdict,
  toEdition,
  toSummary,
  type EditionRecord,
} from "../domain/editions.js";
import type { CaseStudiesRepository } from "../infrastructure/case-studies-repository.js";

export function createCaseStudiesService(deps: {
  repo: CaseStudiesRepository;
  owner: string;
  listOwnedAgentIds: () => Promise<string[]>;
  readArtifactText: (artifactId: string) => Promise<string | null>;
}): CaseStudiesService {
  async function getOwned(id: string): Promise<EditionRecord> {
    const record = await deps.repo.getById(id);
    if (record) {
      const owned = await deps.listOwnedAgentIds();
      if (owned.includes(record.agentId)) return record;
    }
    throw new TRPCError({ code: "NOT_FOUND", message: "edition not found" });
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: Resolves the text an owner is consenting to. A
   * pending Edition is a draft, and the owner's editable copy of it is the
   * linked artifact — so while it is pending the artifact wins, and the row
   * holds only what the agent last submitted. Once released the row is
   * authoritative and never re-reads, because releasing is consent to specific
   * text: a later artifact edit must not rewrite what an inspector already
   * read. Any artifact that cannot stand in for the draft (deleted, not the
   * owner's, binary, too large, or outside the content bounds) falls back to
   * the submitted text rather than failing the read.
   */
  async function resolveDraft(
    record: EditionRecord,
  ): Promise<{ content: string; source: CaseStudyContentSource }> {
    if (record.status !== "pending" || !record.artifactId) {
      return { content: record.content, source: "submitted" };
    }
    const live = await deps.readArtifactText(record.artifactId);
    const parsed = caseStudyContentSchema.safeParse(live);
    if (!parsed.success || parsed.data === record.content) {
      return { content: record.content, source: "submitted" };
    }
    return { content: parsed.data, source: "artifact" };
  }

  return {
    async list() {
      const owned = await deps.listOwnedAgentIds();
      const records = await deps.repo.listByAgents(owned);
      return records.map(toSummary);
    },

    async get(id) {
      const record = await getOwned(id);
      return toEdition(record, await resolveDraft(record));
    },

    async release(id) {
      const record = await getOwned(id);
      const verdict = releaseVerdict(record.status);
      if (verdict === "not-releasable") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `edition is ${record.status}; only a pending edition can be released`,
        });
      }
      if (verdict === "already-released") return toSummary(record);
      const draft = await resolveDraft(record);
      const released = await deps.repo.setStatus(id, "released", draft.content);
      if (!released) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "edition not found",
        });
      }
      securityLog("info", "case_study.released", {
        category: "resource",
        actor: deps.owner,
        actorKind: "user",
        agentId: record.agentId,
        result: "success",
        detail: {
          editionId: id,
          editionWeekStart: record.editionWeekStart,
          contentSource: draft.source,
        },
      });
      return toSummary(released);
    },
  };
}
