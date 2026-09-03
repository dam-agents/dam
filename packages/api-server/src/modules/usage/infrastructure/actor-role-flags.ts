import { actorRoles, eq, type Db } from "db";
import type { SubPseudonymizer } from "../../../core/sub-pseudonymizer.js";

export function carriesInspectorRole(db: Db, pseudo: SubPseudonymizer) {
  return async (sub: string): Promise<boolean> => {
    try {
      const rows = await db
        .select({ isCore: actorRoles.isCore })
        .from(actorRoles)
        .where(eq(actorRoles.actorSub, pseudo.hashSub(sub)))
        .limit(1);
      return rows[0]?.isCore ?? false;
    } catch {
      return false;
    }
  };
}
