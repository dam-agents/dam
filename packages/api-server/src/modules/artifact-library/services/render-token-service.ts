import crypto from "node:crypto";

import type { TtlStore } from "../../../core/ttl-store.js";
import {
  grantCovers,
  isRenderTokenShape,
  type RenderGrant,
} from "../domain/render-grant.js";

export interface RenderTokenService {
  mint(artifactId: string, version: number): Promise<string>;
  redeem(token: string, artifactId: string, version: number): Promise<boolean>;
}

export function createRenderTokenService(deps: {
  grants: TtlStore<RenderGrant>;
}): RenderTokenService {
  const { grants } = deps;
  return {
    async mint(artifactId, version) {
      const token = crypto.randomBytes(32).toString("base64url");
      await grants.set(token, { artifactId, version });
      return token;
    },

    async redeem(token, artifactId, version) {
      if (!isRenderTokenShape(token)) return false;
      const grant = await grants.peek(token);
      return grant !== null && grantCovers(grant, artifactId, version);
    },
  };
}
