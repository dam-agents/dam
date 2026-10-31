import { z } from "zod";

export const entryPointChoiceSchema = z.enum([
  "sandbox",
  "knowledge-base",
  "starter-kit",
]);

export const entryPointChosenInputSchema = z.object({
  choice: entryPointChoiceSchema,
});

export const USAGE_REPORT_FRAME = { ready: "ready", theme: "theme" } as const;

export const usageReportFrameReadySchema = z.object({
  type: z.literal(USAGE_REPORT_FRAME.ready),
});

export const UI_SIGNALS = [
  "rage_click",
  "dead_click",
  "error_shown",
  "js_error",
  "nav_bounce",
  "abandoned_dialog",
  "slow_request",
] as const;

export const UI_FLOW_STEPS = ["open", "submit", "done"] as const;

export const UI_FLOWS = [
  "starter_kit_agent",
  "connect_slack",
  "create_schedule",
  "publish_artifact",
] as const;

export const UI_EVENTS_MAX_BATCH = 50;

const uiRouteSchema = z
  .string()
  .max(120)
  .regex(/^\/[A-Za-z0-9/:_-]*$/);
const uiElementSchema = z
  .string()
  .max(120)
  .regex(/^[A-Za-z0-9:._-]+$/);
const uiMsSchema = z.number().int().min(0).max(86_400_000);

const uiEventBase = {
  route: uiRouteSchema,
  seq: z.number().int().min(0),
  ageMs: uiMsSchema,
};

export const uiEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("view"), ...uiEventBase, dwellMs: uiMsSchema }),
  z.object({
    kind: z.literal("action"),
    ...uiEventBase,
    element: uiElementSchema,
  }),
  z.object({
    kind: z.literal("signal"),
    ...uiEventBase,
    signal: z.enum(UI_SIGNALS),
    element: uiElementSchema.nullable(),
    durationMs: uiMsSchema.optional(),
  }),
  z.object({
    kind: z.literal("flow_step"),
    ...uiEventBase,
    flow: z.enum(UI_FLOWS),
    step: z.enum(UI_FLOW_STEPS),
  }),
]);

export const uiEventsInputSchema = z.object({
  tab: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  build: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9._+-]+$/),
  events: z.array(uiEventSchema).min(1).max(UI_EVENTS_MAX_BATCH),
});
