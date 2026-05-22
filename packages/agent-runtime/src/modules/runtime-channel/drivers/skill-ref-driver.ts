import type { Contribution } from "api-server-api";
import type { Driver } from "./types.js";

type SkillRefContribution = Extract<Contribution, { kind: "skill-ref" }>;

/** Built-in `skill-ref` driver. Phase 1 records the desired skill set
 *  by name+version; the actual install path still flows through the
 *  existing skills tRPC mutations called from api-server. Once we
 *  retire the direct skills tRPC fan-out, this driver takes over
 *  installation via the skills service in-process. */
export const skillRefDriver: Driver<SkillRefContribution> = {
  kind: "skill-ref",
  async apply(c, ctx) {
    ctx.log(
      `[runtime-channel:skill-ref] noted ${c.source}/${c.name}@${c.version} (paths=${c.skillPaths.join(",")}) — install path still owned by skills tRPC in phase 1`,
    );
  },
};
