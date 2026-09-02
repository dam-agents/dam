import { securityLog } from "../../../core/security-log.js";
import {
  kbShareRowId,
  secretsEqual,
  shareIdFromTokenHeader,
} from "../domain/share-string.js";
import type { KbShareRow } from "../domain/types.js";

const MAX_TOKEN_HEADERS = 64;

export interface TokenAuthDeps {
  findActiveById: (rowId: string) => Promise<KbShareRow | null>;
  touchLastUsed: (rowId: string) => Promise<void>;
}

export async function resolveAccessibleShares(
  headers: Headers,
  deps: TokenAuthDeps,
): Promise<Map<string, KbShareRow>> {
  const shareIds: string[] = [];
  const secretByShareId = new Map<string, string>();
  for (const [name, value] of headers.entries()) {
    const shareId = shareIdFromTokenHeader(name);
    if (!shareId) continue;
    if (!secretByShareId.has(shareId)) shareIds.push(shareId);
    secretByShareId.set(shareId, value.trim());
    if (shareIds.length >= MAX_TOKEN_HEADERS) break;
  }

  const accessible = new Map<string, KbShareRow>();
  let denied = 0;
  for (const shareId of shareIds) {
    const row = await deps.findActiveById(kbShareRowId(shareId));
    if (!row || !secretsEqual(row.secret, secretByShareId.get(shareId)!)) {
      denied += 1;
      continue;
    }
    accessible.set(shareId, row);
    void deps.touchLastUsed(row.id).catch(() => {});
  }

  if (denied > 0) {
    securityLog("warn", "kb_share.query_denied", {
      category: "authn",
      actor: null,
      actorKind: "external",
      surface: "mcp",
      decision: "deny",
      reason: "invalid-share-tokens",
      detail: { denied, presented: shareIds.length },
    });
  }
  return accessible;
}
