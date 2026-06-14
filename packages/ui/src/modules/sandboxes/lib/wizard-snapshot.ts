import { z } from "zod";

const SNAPSHOT_KEY = "platform-sandbox-wizard";

export const egressPresetSchema = z.enum(["none", "trusted", "all"]);
export type EgressPreset = z.infer<typeof egressPresetSchema>;

/**
 * Persisted wizard state. Holds only ids and pick-state so the wizard can
 * survive the full-page OAuth redirect in step 3 — never any secret value.
 * Every step's fields exist from the outset; later steps only fill them.
 */
export const wizardSnapshotSchema = z.object({
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  // Step 1 — image: exactly one of these is set.
  templateId: z.string().nullable(),
  customImage: z.string(),
  // Step 2 — setup (filled in sub-issue 02).
  name: z.string(),
  providerSecretId: z.string().nullable(),
  egressPreset: egressPresetSchema,
  // Step 3 — connections (filled in sub-issue 03).
  connectionIds: z.array(z.string()),
});
export type WizardSnapshot = z.infer<typeof wizardSnapshotSchema>;
export type WizardStep = WizardSnapshot["step"];

export const EMPTY_SNAPSHOT: WizardSnapshot = {
  step: 1,
  templateId: null,
  customImage: "",
  name: "",
  providerSecretId: null,
  egressPreset: "trusted",
  connectionIds: [],
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
