import { TRPCError } from "@trpc/server";
import type { CaseStudiesService } from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import {
  releaseVerdict,
  resolveDraft,
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

  return {
    async list() {
      const owned = await deps.listOwnedAgentIds();
      const records = await deps.repo.listByAgents(owned);
      return records.map((record) => toSummary(record));
    },

    async get(id) {
      const record = await getOwned(id);
      return toEdition(
        record,
        await resolveDraft(record, deps.readArtifactText),
      );
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
      const draft = await resolveDraft(record, deps.readArtifactText);
      const released = await deps.repo.setStatus(id, "released", draft);
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
