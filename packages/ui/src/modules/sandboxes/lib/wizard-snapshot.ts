import {
  knowledgeBaseTemplateIdSchema,
  type ProviderPresetType,
} from "api-server-api";
import { z } from "zod";

import { DEFAULT_KB_TEMPLATE_ID } from "../../knowledge-bases/lib/kb-templates.js";

const SNAPSHOT_KEY = "platform-sandbox-wizard";

export const egressPresetSchema = z.enum(["none", "trusted", "all"]);
export type EgressPreset = z.infer<typeof egressPresetSchema>;

export const startingPointSchema = z.enum([
  "experiment",
  "knowledge-base",
  "specialized",
  "general-purpose",
  "custom",
]);
export type StartingPoint = z.infer<typeof startingPointSchema>;

export const KINDED_HARNESS_TEMPLATE_ID = "claude-code";

export const wizardSnapshotSchema = z.object({
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  maxStep: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  startingPoint: startingPointSchema.nullable().default(null),
  templateId: z.string().nullable(),
  kbTemplateId: knowledgeBaseTemplateIdSchema.nullable().default(null),
  customImage: z.string(),
  name: z.string(),
  providerRef: z
    .preprocess(
      (v) => (v && typeof v === "object" && "source" in v ? null : v),
      z.object({ id: z.string() }).nullable(),
    )
    .default(null),
  egressPreset: egressPresetSchema,
  connectionIds: z.array(z.string()),
  sizeCpuMilli: z.number().int().nullable().default(null),
  sizeMemoryMi: z.number().int().nullable().default(null),
});
export type WizardSnapshot = z.infer<typeof wizardSnapshotSchema>;
export type WizardStep = WizardSnapshot["step"];

export const EMPTY_SNAPSHOT: WizardSnapshot = {
  step: 1,
  maxStep: 1,
  startingPoint: null,
  templateId: null,
  kbTemplateId: null,
  customImage: "",
  name: "",
  providerRef: null,
  egressPreset: "trusted",
  connectionIds: [],
  sizeCpuMilli: null,
  sizeMemoryMi: null,
};

const KINDED_PROVIDERS: readonly ProviderPresetType[] = [
  "ibm-litellm",
  "anthropic",
];

export function providerPolicy(startingPoint: StartingPoint | null): {
  allow?: readonly ProviderPresetType[];
  recommended?: ProviderPresetType;
} {
  if (startingPoint === "experiment" || startingPoint === "knowledge-base") {
    return { allow: KINDED_PROVIDERS, recommended: "ibm-litellm" };
  }
  return {};
}

export function startingPointDefaults(
  startingPoint: StartingPoint,
): Partial<WizardSnapshot> {
  const cleared = {
    startingPoint,
    templateId: null,
    kbTemplateId: null,
    customImage: "",
    providerRef: null,
  };
  switch (startingPoint) {
    case "experiment":
      return { ...cleared, templateId: KINDED_HARNESS_TEMPLATE_ID };
    case "knowledge-base":
      return {
        ...cleared,
        templateId: KINDED_HARNESS_TEMPLATE_ID,
        kbTemplateId: DEFAULT_KB_TEMPLATE_ID,
      };
    default:
      return cleared;
  }
}

export function startingPointComplete(snapshot: WizardSnapshot): boolean {
  switch (snapshot.startingPoint) {
    case "experiment":
      return snapshot.templateId !== null;
    case "knowledge-base":
      return snapshot.templateId !== null && snapshot.kbTemplateId !== null;
    case "specialized":
    case "general-purpose":
      return snapshot.templateId !== null;
    case "custom":
      return snapshot.customImage.trim().length > 0;
    case null:
      return false;
  }
}

function inferStartingPoint(
  snapshot: Omit<WizardSnapshot, "startingPoint">,
): StartingPoint | null {
  if (snapshot.customImage.trim().length > 0) return "custom";
  if (snapshot.templateId !== null) return "general-purpose";
  return null;
}

export function loadSnapshot(): WizardSnapshot {
  const raw = sessionStorage.getItem(SNAPSHOT_KEY);
  if (!raw) return EMPTY_SNAPSHOT;
  try {
    const parsed = wizardSnapshotSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return EMPTY_SNAPSHOT;
    return {
      ...parsed.data,
      startingPoint:
        parsed.data.startingPoint ?? inferStartingPoint(parsed.data),
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
