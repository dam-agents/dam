import { z } from "zod";

export const entryPointChoiceSchema = z.enum([
  "sandbox",
  "experiment",
  "knowledge-base",
]);

export const entryPointChosenInputSchema = z.object({
  choice: entryPointChoiceSchema,
});
