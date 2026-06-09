import { z } from "zod";

const SNAPSHOT_KEY = "platform-v2-wizard";

/**
 * Persisted wizard state. Holds only ids and pick-state so the wizard can
 * survive the full-page OAuth redirect — never any secret value. The current
 * step is derived from the route, not stored here.
 */
export const wizardSnapshotSchema = z.object({
  name: z.string(),
  harness: z.enum(["claude-code", "bob", "codex", "pi-agent", "custom"]),
  // Set only when harness === "custom": the BYO container image (repo:tag).
  customImage: z.string(),
  // The single provider key connected for the new agent (the harness uses one
  // LLM backend). `llmProvider` is the chosen mode id; `llmSecretId` the key.
  llmProvider: z
    .enum(["anthropic-api", "anthropic-oauth", "ibm-litellm", "bob", "openai"])
    .nullable(),
  llmSecretId: z.string().nullable(),
  // Network access for the new sandbox; mirrors the create mutation's egress
  // preset (trusted = curated allowlist, none = default-deny, all = open).
  egressPreset: z.enum(["none", "trusted", "all"]),
  // Connections created via the modal (GitHub, GHE, MCP, custom). Granted to
  // the new agent at create. Readiness is derived from live connection status.
  connectionIds: z.array(z.string()),
  // Skills picked on the final step. Installed against the new agent after it
  // is created (skills.install requires an agentId), keyed by source + name.
  skills: z.array(
    z.object({
      source: z.string(),
      name: z.string(),
      version: z.string(),
      contentHash: z.string().optional(),
    }),
  ),
  // "Clone a repo into the sandbox" — seeded into the working dir at create.
  // (Local file imports are NOT here: File objects can't survive sessionStorage.)
  gitRepoUrl: z.string(),
  gitRepoRef: z.string(),
});
export type WizardSnapshot = z.infer<typeof wizardSnapshotSchema>;

export const EMPTY_SNAPSHOT: WizardSnapshot = {
  name: "",
  harness: "claude-code",
  customImage: "",
  llmProvider: null,
  llmSecretId: null,
  egressPreset: "trusted",
  connectionIds: [],
  skills: [],
  gitRepoUrl: "",
  gitRepoRef: "",
};

export function loadSnapshot(): WizardSnapshot {
  const raw = sessionStorage.getItem(SNAPSHOT_KEY);
  if (!raw) return EMPTY_SNAPSHOT;
  try {
    const parsed = wizardSnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_SNAPSHOT;
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export function saveSnapshot(snapshot: WizardSnapshot): void {
  sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function clearSnapshot(): void {
  sessionStorage.removeItem(SNAPSHOT_KEY);
}
