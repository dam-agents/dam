import {
  knowledgeBaseTemplateIdSchema,
  type ProviderPresetType,
} from "api-server-api";
import { z } from "zod";

import { DEFAULT_KB_TEMPLATE_ID } from "../../knowledge-bases/lib/kb-templates.js";

const SNAPSHOT_KEY = "platform-sandbox-wizard";

export const egressPresetSchema = z.enum(["none", "trusted", "all"]);
export type EgressPreset = z.infer<typeof egressPresetSchema>;

/** The step-1 choice: decides what the step reveals and which create path
 *  finishes. `experiment` and `knowledge-base` mint an Agent Kind. */
export const startingPointSchema = z.enum([
  "experiment",
  "knowledge-base",
  "specialized",
  "general-purpose",
  "custom",
]);
export type StartingPoint = z.infer<typeof startingPointSchema>;

/** Pinned on the kinded paths: both setups are exercised against Claude Code,
 *  and the experiment kit is staged only in that image. */
export const KINDED_HARNESS_TEMPLATE_ID = "claude-code";

/** Persisted wizard state — ids and pick-state only, never secret values. */
export const wizardSnapshotSchema = z.object({
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  maxStep: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  startingPoint: startingPointSchema.nullable().default(null),
  templateId: z.string().nullable(),
  /** The installation procedure; set only on the `knowledge-base` path. */
  kbTemplateId: knowledgeBaseTemplateIdSchema.nullable().default(null),
  // Filters step 1 to VM-backed templates. Not sent on create — the backend
  // rides the chosen template — and inert unless the vm-sandboxes feature is on.
  vm: z.boolean().default(false),
  customImage: z.string(),
  name: z.string(),
  // The selected provider Connection (the single credential model). A snapshot
  // persisted by a pre-#1273 build carried a `{source, id}` shape where the id
  // could be a legacy *secret* id; drop those to null rather than let a secret
  // id leak through as a connection id on finish.
  providerRef: z
    .preprocess(
      (v) => (v && typeof v === "object" && "source" in v ? null : v),
      z.object({ id: z.string() }).nullable(),
    )
    .default(null),
  egressPreset: egressPresetSchema,
  connectionIds: z.array(z.string()),
  // The chosen sandbox Size (#1900) in slider units (CPU millicores,
  // memory Mi). null = untouched — the template's default applies and no
  // `size` rides the create call.
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
  vm: false,
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

/** The providers a starting point offers. The kinded paths run on Claude Code, so
 *  they offer the two credentials that reach Claude — the IBM proxy or Anthropic
 *  directly — and steer toward the proxy. Bob and OpenAI would need a different
 *  harness, so offering them here only sets up a failure at the first model call. */
export function providerPolicy(startingPoint: StartingPoint | null): {
  allow?: readonly ProviderPresetType[];
  recommended?: ProviderPresetType;
} {
  if (startingPoint === "experiment" || startingPoint === "knowledge-base") {
    return { allow: KINDED_PROVIDERS, recommended: "ibm-litellm" };
  }
  return {};
}

/** Clears downstream image state so the reveal starts clean, and pins what the
 *  kinded paths don't ask for. Also drops the provider pick, which the kinded
 *  paths may no longer offer — `autoSelectFirst` refills it, preferring the
 *  recommended one, so the usual case is invisible. */
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

/** Whether step 1 has everything the chosen starting point needs. */
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

/** A draft saved before step 1 asked for a starting point has an image but no
 *  choice, which would render an empty step 1 and hide the pick. Recover it from
 *  what the old wizard did record. A specialized image can't be told from a
 *  harness one without the template list, so it lands on general-purpose and the
 *  user re-picks; the draft is otherwise intact. */
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
