import { z } from "zod";

const SNAPSHOT_KEY = "platform-sandbox-wizard";

export const egressPresetSchema = z.enum(["none", "trusted", "all"]);
export type EgressPreset = z.infer<typeof egressPresetSchema>;

/** Persisted wizard state — ids and pick-state only, never secret values. */
export const wizardSnapshotSchema = z.object({
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  templateId: z.string().nullable(),
  customImage: z.string(),
  name: z.string(),
  providerSecretId: z.string().nullable(),
  egressPreset: egressPresetSchema,
  connectionIds: z.array(z.string()),
  // Defaulted so a snapshot written by an earlier build still parses.
  pendingConnectionId: z.string().nullable().default(null),
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
  pendingConnectionId: null,
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
