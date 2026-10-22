import type { SignUps, TermsDocument, TermsService } from "api-server-api";
import type { TermsAcceptancesRepository } from "../infrastructure/terms-acceptances-repository.js";

export function createTermsService(deps: {
  current: TermsDocument;
  repo: TermsAcceptancesRepository;
  signUps: SignUps;
}): TermsService {
  const { current, repo, signUps } = deps;
  return {
    current: () => ({ version: current.version, hash: current.hash }),
    document: () => ({
      version: current.version,
      text: current.text,
      hash: current.hash,
    }),
    accept: async (sub, version) => {
      if (signUps === "closed" && (await repo.findLatest(sub)) === null) {
        return { ok: false, error: { type: "SignUpsClosed" } };
      }
      await repo.recordAcceptance(sub, version, current.hash);
      return { ok: true, value: null };
    },
    latestAcceptance: (sub) => repo.findLatest(sub),
    isAccepted: async (sub) => {
      const row = await repo.findForVersion(sub, current.version);
      return row !== null;
    },
  };
}
