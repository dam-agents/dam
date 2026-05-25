import { z } from "zod";
import type { ConnectionTemplate } from "../connection-template.js";

/**
 * GitHub.com Connection Template (ADR-051). Authorization-Code OAuth with
 * a fixed client id + secret (operator-supplied at deploy time). Emits:
 *   - `env GH_TOKEN` — placeholder injected at controller render time
 *     (ADR-040 mechanism preserved).
 *   - `egress-host api.github.com` — routed to egress_rules at grant time.
 *
 * The token bytes never travel with the Contribution. They live in a
 * SecretRef the gateway pod reads via SDS; the env contribution carries
 * only a placeholder for the controller's render path.
 */
const inputsSchema = z.object({
  // No user input — preset template uses operator-supplied client.
});

export function createGitHubTemplate(opts: {
  clientId: string;
  scopes?: string[];
}): ConnectionTemplate<z.infer<typeof inputsSchema>> {
  const scopes = opts.scopes ?? ["repo", "read:user", "user:email"];
  return {
    id: "github",
    name: "GitHub",
    category: "app",
    isCustom: false,
    description: "Read and write GitHub repos, issues, and PRs.",
    iconSlug: "github",
    authKinds: ["oauth"],
    contributedKinds: ["env", "egress-host"],
    inputs: inputsSchema,

    build({ mintSecretRef }) {
      const secretPath = mintSecretRef("connection:github");
      return {
        auth: {
          kind: "oauth",
          clientId: opts.clientId,
          refreshTokenRef: { ...secretPath, field: "refresh_token" },
          accessTokenRef: { ...secretPath, field: "access_token" },
          scopes,
          tokenUrl: "https://github.com/login/oauth/access_token",
          authorizationUrl: "https://github.com/login/oauth/authorize",
        },
        contributions: [
          { kind: "egress-host", host: "api.github.com" },
          { kind: "egress-host", host: "github.com" },
          {
            kind: "env",
            name: "GH_TOKEN",
            placeholder: "dummy-placeholder",
          },
        ],
        // Empty at create time — tokens populate on OAuth callback.
        secrets: new Map(),
        defaultName: "GitHub",
      };
    },

    toView() {
      return {
        id: "github",
        name: "GitHub",
        category: "app",
        isCustom: false,
        description: "Read and write GitHub repos, issues, and PRs.",
        iconSlug: "github",
        authKinds: ["oauth"],
        contributedKinds: ["env", "egress-host"],
      };
    },
  };
}
