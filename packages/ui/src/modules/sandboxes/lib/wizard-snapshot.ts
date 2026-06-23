import { z } from "zod";

const SNAPSHOT_KEY = "platform-sandbox-wizard";

export const egressPresetSchema = z.enum(["none", "trusted", "all"]);
export type EgressPreset = z.infer<typeof egressPresetSchema>;

/** Persisted wizard state — ids and pick-state only, never secret values. */
export const wizardSnapshotSchema = z.object({
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  maxStep: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  templateId: z.string().nullable(),
  customImage: z.string(),
  name: z.string(),
  // A provider can be a Connection (new) or a legacy provider Secret.
  providerRef: z
    .discriminatedUnion("source", [
      z.object({ source: z.literal("connection"), id: z.string() }),
      z.object({ source: z.literal("secret"), id: z.string() }),
    ])
    .nullable()
    .default(null),
  egressPreset: egressPresetSchema,
  connectionIds: z.array(z.string()),
  // Defaulted so a snapshot written by an earlier build still parses.
  pendingConnectionId: z.string().nullable().default(null),
});
export type WizardSnapshot = z.infer<typeof wizardSnapshotSchema>;
export type WizardStep = WizardSnapshot["step"];

export const EMPTY_SNAPSHOT: WizardSnapshot = {
  step: 1,
  maxStep: 1,
  templateId: null,
  customImage: "",
  name: "",
  providerRef: null,
  egressPreset: "trusted",
  connectionIds: [],
  pendingConnectionId: null,
};

export function loadSnapshot(): WizardSnapshot {
  const raw = sessionStorage.getItem(SNAPSHOT_KEY);
  if (!raw) return EMPTY_SNAPSHOT;
  try {
    const parsed = wizardSnapshotSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return EMPTY_SNAPSHOT;
    return {
      ...parsed.data,
      maxStep: Math.max(parsed.data.maxStep, parsed.data.step) as WizardStep,
    };
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
