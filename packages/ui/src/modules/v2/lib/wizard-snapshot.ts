import { z } from "zod";

const SNAPSHOT_KEY = "platform-v2-wizard";

/**
 * Persisted wizard state. Holds only ids and pick-state so the wizard can
 * survive the full-page OAuth redirect in step 2 — never any secret value.
 */
export const wizardSnapshotSchema = z.object({
  step: z.union([z.literal(1), z.literal(2)]),
  name: z.string(),
  harness: z.enum(["claude-code", "bob", "codex"]),
  llmProvider: z
    .enum(["anthropic-api", "anthropic-oauth", "ibm-litellm", "bob", "openai"])
    .nullable(),
  llmSecretId: z.string().nullable(),
  // GitHub.com and GitHub Enterprise are independent — a sandbox can have both.
  githubConnectionId: z.string().nullable(),
  githubAuthorized: z.boolean(),
  gheHost: z.string(),
  gheConnectionId: z.string().nullable(),
  gheAuthorized: z.boolean(),
});
export type WizardSnapshot = z.infer<typeof wizardSnapshotSchema>;

export const EMPTY_SNAPSHOT: WizardSnapshot = {
  step: 1,
  name: "",
  harness: "claude-code",
  llmProvider: null,
  llmSecretId: null,
  githubConnectionId: null,
  githubAuthorized: false,
  gheHost: "",
  gheConnectionId: null,
  gheAuthorized: false,
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
