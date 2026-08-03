import type { z } from "zod";
import type {
  egressPresetSchema,
  egressRuleCreateInputSchema,
  egressRuleUpdateInputSchema,
  ruleVerdictSchema,
} from "./schemas.js";

export type RuleVerdict = z.infer<typeof ruleVerdictSchema>;

/**
 * Bulk-seeding preset chosen at agent creation. Each preset writes 0..N
 * `egress_rules` rows with `source = preset:<name>` (or no rows at all
 * for `none`). After seeding the rows are owned by the agent — editing
 * any row promotes it to `manual` like a connection-derived rule.
 *
 * - `none` — no rules. Every egress hits the inbox until the user approves.
 * - `trusted` — Anthropic-published default-allowed list (npm, PyPI,
 *   GitHub, package mirrors, etc.). Recommended default.
 * - `all` — single wildcard rule the L4 gate matches for every SNI.
 *   Development escape hatch with a UI warning.
 */
export type EgressPreset = z.infer<typeof egressPresetSchema>;

/**
 * Origin of a rule row. User edits/deletes flip non-`manual` rows to
 * `manual` so later connection revokes / preset reseeds don't undo a
 * deliberate user decision. The UI reads non-`manual` sources to render the
 * "(was from …)" annotation.
 */
export type EgressRuleSource =
  | "manual"
  | "inbox"
  | `connection:${string}`
  | "preset:trusted"
  | "preset:all";

export interface EgressRuleView {
  id: string;
  agentId: string;
  host: string;
  /** Upstream port when not 443. Transparency only — matching is host-based. */
  port?: number;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
  decidedBy: string;
  decidedAt: string;
  source: EgressRuleSource;
}

export type EgressRuleCreateInput = z.infer<typeof egressRuleCreateInputSchema>;
export type EgressRuleUpdateInput = z.infer<typeof egressRuleUpdateInputSchema>;

export interface EgressRulesService {
  listForAgent(agentId: string): Promise<EgressRuleView[]>;
  /** Returns the agent's effective preset, derived from the `source` of its
   *  active egress rules: any `preset:all` row → "all"; any `preset:trusted`
   *  row → "trusted"; otherwise "none". The preset is not stored on the
   *  agent spec — the rules' own sources are the truth. */
  currentPreset(agentId: string): Promise<EgressPreset>;
  /** Hosts seeded by the `trusted` preset. Sourced from the helm-mounted
   *  ConfigMap at boot. Exposed so the UI can render a preview of the rules
   *  the trusted preset would produce without having to apply it first. */
  trustedHosts(): Promise<readonly string[]>;
  /** Always writes `source = 'manual'`. */
  create(input: EgressRuleCreateInput): Promise<EgressRuleView>;
  /** Flips `source` to `'manual'` even if the row was previously
   *  connection- or preset-derived. Mirrors how connection-injected envs
   *  become user-owned on edit. */
  update(input: EgressRuleUpdateInput): Promise<EgressRuleView>;
  revoke(id: string): Promise<void>;
  /** Bulk-adds rules for `preset` to an existing agent. Idempotent against
   *  rows already present. Does NOT remove rules; the user manages deletes
   *  via `revoke`. */
  applyPreset(agentId: string, preset: EgressPreset): Promise<void>;
}
