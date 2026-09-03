import crypto from "node:crypto";

import type { TtlStore } from "../../../core/ttl-store.js";
import {
  grantCovers,
  isRenderTokenShape,
  type RenderGrant,
} from "../domain/render-grant.js";
import type { ArtifactRow } from "../infrastructure/artifact-library-repository.js";

export interface RenderTokenService {
  mint(artifact: ArtifactRow, version: number): Promise<string>;
  redeem(
    token: string,
    artifact: ArtifactRow,
    version: number,
  ): Promise<boolean>;
}

export function createRenderTokenService(deps: {
  grants: TtlStore<RenderGrant>;
}): RenderTokenService {
  const { grants } = deps;
  return {
    async mint(artifact, version) {
      const token = crypto.randomBytes(32).toString("base64url");
      await grants.set(token, { artifactId: artifact.id, version });
      return token;
    },

    async redeem(token, artifact, version) {
      if (!isRenderTokenShape(token)) return false;
      const grant = await grants.peek(token);
      return grant !== null && grantCovers(grant, artifact.id, version);
    },
  };
}
