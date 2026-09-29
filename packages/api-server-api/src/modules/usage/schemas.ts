import { z } from "zod";

export const entryPointChoiceSchema = z.enum([
  "sandbox",
  "knowledge-base",
  "starter-kit",
]);

export const entryPointChosenInputSchema = z.object({
  choice: entryPointChoiceSchema,
});
