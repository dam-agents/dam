import type { z } from "zod";

import type {
  entryPointChoiceSchema,
  UI_FLOW_STEPS,
  UI_FLOWS,
  UI_SIGNALS,
  uiEventSchema,
  uiEventsInputSchema,
} from "./schemas.js";

export type EntryPointChoice = z.infer<typeof entryPointChoiceSchema>;
export type UiEvent = z.infer<typeof uiEventSchema>;
export type UiEventsInput = z.infer<typeof uiEventsInputSchema>;
export type UiSignal = (typeof UI_SIGNALS)[number];
export type UiFlow = (typeof UI_FLOWS)[number];
export type UiFlowStep = (typeof UI_FLOW_STEPS)[number];

export interface UiTelemetrySettings {
  enabled: boolean;
  build: string;
}

export interface UsageService {
  entryPointChosen(choice: EntryPointChoice): void;
  uiTelemetry(): UiTelemetrySettings;
  uiEvents(input: UiEventsInput): Promise<void>;
}
