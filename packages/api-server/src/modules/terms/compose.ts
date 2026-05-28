import { createHash } from "node:crypto";
import type { Db } from "db";
import type { TermsService } from "api-server-api";
import { createTermsAcceptancesRepository } from "./infrastructure/terms-acceptances-repository.js";
import { createTermsService } from "./services/terms-service.js";

export type IsAcceptedPort = (sub: string) => Promise<boolean>;

export function composeTermsModule(deps: {
  db: Db;
  version: string;
  text: string;
}): {
  service: TermsService;
  isAcceptedPort: IsAcceptedPort;
} {
  const hash = createHash("sha256").update(deps.text).digest("hex");
  const repo = createTermsAcceptancesRepository(deps.db);
  const service = createTermsService({
    current: { version: deps.version, text: deps.text, hash },
    repo,
  });
  return {
    service,
    isAcceptedPort: (sub) => service.isAccepted(sub),
  };
}
