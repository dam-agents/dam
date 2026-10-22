import { z } from "zod";

export const operatorStatusSchema = z.object({ isOperator: z.boolean() });
