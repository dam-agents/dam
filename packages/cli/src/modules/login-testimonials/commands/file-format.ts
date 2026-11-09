import { z } from "zod";

export const testimonialsFileSchema = z.object({
  testimonials: z.array(
    z.object({
      name: z.string(),
      role: z.string().default(""),
      quote: z.string(),
      photo: z.string().nullable().default(null),
    }),
  ),
});

export type TestimonialsFile = z.infer<typeof testimonialsFileSchema>;
