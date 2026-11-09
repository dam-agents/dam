import type { z } from "zod";
import type {
  loginTestimonialInputSchema,
  loginTestimonialSchema,
  loginTestimonialsSaveInputSchema,
} from "./schemas.js";

export type LoginTestimonialInput = z.input<typeof loginTestimonialInputSchema>;
export type LoginTestimonial = z.infer<typeof loginTestimonialSchema>;
export type LoginTestimonialsSaveInput = z.infer<
  typeof loginTestimonialsSaveInputSchema
>;

// UNIT_BOUNDARY_DESCRIPTION: the operator's hold on the quotes the login page shows, in their order. A save replaces the whole list, so a reorder, an edit and a removal are one call and the page never shows a half-edited list. A photo is the id of an image an avatar upload stored; a save naming an id that is not stored is refused.
export interface LoginTestimonialsService {
  list(): Promise<LoginTestimonial[]>;
  save(input: LoginTestimonialsSaveInput): Promise<LoginTestimonial[]>;
}
