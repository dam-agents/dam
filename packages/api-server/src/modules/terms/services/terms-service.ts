import type { TermsService } from "api-server-api";
import {
  buildCurrent,
  buildDocument,
  type CurrentTerms,
} from "../domain/terms.js";
import type { TermsAcceptancesRepository } from "../infrastructure/terms-acceptances-repository.js";

export function createTermsService(deps: {
  current: CurrentTerms;
  repo: TermsAcceptancesRepository;
}): TermsService {
  const { current, repo } = deps;
  return {
    current: () => buildCurrent(current),
    document: () => buildDocument(current),
    accept: async (sub, version) => {
      await repo.recordAcceptance(sub, version, current.hash);
    },
    latestAcceptance: (sub) => repo.findLatest(sub),
    isAccepted: async (sub) => {
      const row = await repo.findForVersion(sub, current.version);
      return row !== null;
    },
  };
}
