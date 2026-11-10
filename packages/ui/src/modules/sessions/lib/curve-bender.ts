import type { SessionPair } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: which CurveBender notice a chat shows, and to
 * whom: a chat that does not exist yet, on an install whose shared Connection
 * the person holds, once the pair read has answered, so a chat already on
 * CurveBender never flashes the offer to switch to it. A pair read that fails,
 * such as an agent with no default model, counts as answered and gets the offer.
 */
export function curveBenderNotice({
  sessionId,
  sharedId,
  pair,
  pairSettled,
}: {
  sessionId: string | null;
  sharedId: string | undefined;
  pair: SessionPair | null | undefined;
  pairSettled: boolean;
}): "setup" | "offer" | null {
  if (sessionId || !sharedId || !pairSettled) return null;
  return pair?.provider === sharedId ? "setup" : "offer";
}
