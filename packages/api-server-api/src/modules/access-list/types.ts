import type { z } from "zod";
import type {
  accessListAddInputSchema,
  accessListEntrySchema,
  accessListRemoveInputSchema,
  accessListSchema,
} from "./schemas.js";

export type AccessListEntry = z.infer<typeof accessListEntrySchema>;
export type AccessList = z.infer<typeof accessListSchema>;
export type AccessListAddInput = z.infer<typeof accessListAddInputSchema>;
export type AccessListRemoveInput = z.infer<typeof accessListRemoveInputSchema>;

// UNIT_BOUNDARY_DESCRIPTION: the operator's hold on the install's Access List, the email addresses Keycloak lets sign in. `enabled` says whether Keycloak checks the list on this install; operators can fill it before it is turned on. An add or a remove takes effect at that person's next sign-in.
export interface AccessListService {
  list(): Promise<AccessList>;
  add(input: AccessListAddInput): Promise<AccessList>;
  remove(input: AccessListRemoveInput): Promise<AccessList>;
}
