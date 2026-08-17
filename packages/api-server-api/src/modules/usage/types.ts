import type { z } from "zod";

import type { entryPointChoiceSchema } from "./schemas.js";

export type EntryPointChoice = z.infer<typeof entryPointChoiceSchema>;

export interface UsageService {
  entryPointChosen(choice: EntryPointChoice): void;
}
