import { z } from "zod";

export const LOGIN_TESTIMONIALS_MAX = 20;

export const loginTestimonialPhotoIdSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "a photo is the id an avatar upload returns");

export const loginTestimonialInputSchema = z.object({
  name: z.string().trim().min(1, "a name is required").max(80),
  role: z.string().trim().max(120).default(""),
  quote: z.string().trim().min(1, "a quote is required").max(600),
  photoId: loginTestimonialPhotoIdSchema.nullable().default(null),
});

export const loginTestimonialsSaveInputSchema = z.object({
  testimonials: z
    .array(loginTestimonialInputSchema)
    .max(
      LOGIN_TESTIMONIALS_MAX,
      `at most ${LOGIN_TESTIMONIALS_MAX} testimonials`,
    ),
});

export const loginTestimonialSchema = loginTestimonialInputSchema.extend({
  role: z.string(),
  photoId: loginTestimonialPhotoIdSchema.nullable(),
  updatedAt: z.string(),
});
