import type { z } from "zod";
import type { operatorStatusSchema } from "./schemas.js";

export type OperatorStatus = z.infer<typeof operatorStatusSchema>;
