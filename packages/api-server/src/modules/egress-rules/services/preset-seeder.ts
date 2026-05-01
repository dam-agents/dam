import { randomUUID } from "node:crypto";
import type { EgressPreset } from "api-server-api";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";

/**
 * Applies an egress preset to an agent by sweeping any previous
 * preset-derived rows and seeding the new ones. Manual and connection-
 * derived rows are not touched.
 *
 * Same primitive runs at agent-create time (no preset rows yet — sweep is
 * a no-op) and from the user-facing `applyPreset` (sweep clears the prior
 * preset, then seeds the new one). Switching `trusted` → `all` revokes the
 * ~25 trusted rows and inserts the single wildcard; switching back goes
 * the other way. `none` clears preset rules without seeding anything.
 *
 * The seeder is decoupled from the `EgressRulesService` because:
 *   - It runs in the agent-create flow under the *system* identity, not
 *     a user-scoped service.
 *   - It writes rules with `source = preset:<name>`, not `manual`.
 *   - It bypasses the agent-ownership check (the agent is being created
 *     in the same atomic flow; ownership is implied).
 */
export interface PresetSeeder {
  seed(agentId: string, preset: EgressPreset, decidedBy: string): Promise<void>;
}

export interface CreatePresetSeederDeps {
  repo: EgressRulesRepository;
  /** Loaded once at boot from the helm-mounted trusted-hosts file. */
  trustedHosts: readonly string[];
}

export function createPresetSeeder(deps: CreatePresetSeederDeps): PresetSeeder {
  return {
    async seed(agentId, preset, decidedBy) {
      // Sweep previous preset rows first so switching presets doesn't
      // pile up. No-op on initial agent-create; clears on every later
      // applyPreset including `none` (which seeds nothing afterwards).
      await deps.repo.revokePresetRowsForAgent(agentId);
      if (preset === "none") return;
      if (preset === "all") {
        await deps.repo.insert({
          id: randomUUID(),
          agentId,
          host: "*",
          method: "*",
          pathPattern: "*",
          verdict: "allow",
          decidedBy,
          source: "preset:all",
        });
        return;
      }
      // `trusted`: one row per host. The list is small (~25 entries) and
      // changes rarely, so a per-row insert keeps the code simple. Each
      // hits the unique-index conflict path on retry, no rollback needed.
      for (const host of deps.trustedHosts) {
        await deps.repo.insert({
          id: randomUUID(),
          agentId,
          host,
          method: "*",
          pathPattern: "*",
          verdict: "allow",
          decidedBy,
          source: "preset:trusted",
        });
      }
    },
  };
}
