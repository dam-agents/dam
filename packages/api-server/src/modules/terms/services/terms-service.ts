import type { TermsDocument, TermsService } from "api-server-api";
import type { TermsAcceptancesRepository } from "../infrastructure/terms-acceptances-repository.js";

export function createTermsService(deps: {
  current: TermsDocument;
  repo: TermsAcceptancesRepository;
}): TermsService {
  const { current, repo } = deps;
  return {
    current: () => ({ version: current.version, hash: current.hash }),
    document: () => ({
      version: current.version,
      text: current.text,
      hash: current.hash,
    }),
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
