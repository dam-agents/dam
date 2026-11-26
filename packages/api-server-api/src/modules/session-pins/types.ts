import type { z } from "zod";

import type { AttentionItem } from "../attention/types.js";
import type { sessionPinKeySchema } from "./schemas.js";

export type SessionPinKey = z.infer<typeof sessionPinKeySchema>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: one Session a user pinned in the sidebar. The
 * pin names the Session and never proves it exists. `item` is the user's
 * attention record row for it, the same row the sidebar's session list
 * shows, so a pinned row needs no call to a sleeping Agent; it is null where
 * the record holds no row for this user, such as a Session on a Shared Agent.
 */
export interface SessionPin extends SessionPinKey {
  pinnedAt: string;
  item: AttentionItem | null;
}

export interface SessionPinList {
  pins: SessionPin[];
}

export interface SessionPinsService {
  list(): Promise<SessionPinList>;
  pin(key: SessionPinKey): Promise<void>;
  unpin(key: SessionPinKey): Promise<void>;
}
