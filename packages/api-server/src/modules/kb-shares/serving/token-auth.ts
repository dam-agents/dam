import { securityLog } from "../../../core/security-log.js";
import { kbShareRowId, secretsEqual } from "../domain/share-string.js";
import type { KbShareRow } from "../domain/types.js";

const TOKEN_HEADER_PATTERN = /^x-kb-token-([0-9a-f]{12})$/;
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
    const match = TOKEN_HEADER_PATTERN.exec(name.toLowerCase());
    if (!match) continue;
    const shareId = match[1]!;
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
