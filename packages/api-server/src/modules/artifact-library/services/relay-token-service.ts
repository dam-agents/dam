import crypto from "node:crypto";

import type { TtlStore } from "../../../core/ttl-store.js";
import {
  isRelayTokenShape,
  relayGrantCovers,
  relayGrantFor,
  type RelayCaller,
  type RelayGrant,
} from "../domain/relay-grant.js";

export interface RelayTokenService {
  mint(caller: RelayCaller): Promise<string>;
  verify(token: string | undefined, caller: RelayCaller): Promise<boolean>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the relay token proves that a call to the share
 * host's relay routes comes from the share page the viewer opened. The share
 * cookie cannot prove it: the browser sends that cookie with a call any page
 * on the same site forges. The share page gets one token when it renders,
 * bound to the artifact, its version, the viewer and their share sign-in, and
 * only that page holds it. A call whose token was minted for another viewer,
 * another sign-in or an older version is refused.
 */
export function createRelayTokenService(deps: {
  grants: TtlStore<RelayGrant>;
}): RelayTokenService {
  const { grants } = deps;
  return {
    async mint(caller) {
      const token = crypto.randomBytes(32).toString("base64url");
      await grants.set(token, relayGrantFor(caller));
      return token;
    },

    async verify(token, caller) {
      if (token === undefined || !isRelayTokenShape(token)) return false;
      const grant = await grants.peek(token);
      return grant !== null && relayGrantCovers(grant, caller);
    },
  };
}
