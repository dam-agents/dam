import { z } from "zod";

export const LOGIN_TESTIMONIALS_MAX = 20;

export const LOGIN_TESTIMONIAL_LIMITS = {
  name: 80,
  role: 120,
  quote: 700,
} as const;

export const loginTestimonialPhotoIdSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "a photo is the id an avatar upload returns");

export const loginTestimonialInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "a name is required")
    .max(
      LOGIN_TESTIMONIAL_LIMITS.name,
      `a name is at most ${LOGIN_TESTIMONIAL_LIMITS.name} characters`,
    ),
  role: z
    .string()
    .trim()
    .max(
      LOGIN_TESTIMONIAL_LIMITS.role,
      `a role is at most ${LOGIN_TESTIMONIAL_LIMITS.role} characters`,
    )
    .default(""),
  quote: z
    .string()
    .trim()
    .min(1, "a quote is required")
    .max(
      LOGIN_TESTIMONIAL_LIMITS.quote,
      `a quote is at most ${LOGIN_TESTIMONIAL_LIMITS.quote} characters`,
    ),
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
