import { z } from "zod";

export const brandSchema = z.object({
  name: z.string(),
  short: z.string(),
  theme: z.object({
    light: z.object({
      accent: z.string(),
      accentHover: z.string(),
      accentLight: z.string(),
    }),
    dark: z.object({
      accent: z.string(),
      accentHover: z.string(),
      accentLight: z.string(),
    }),
  }),
});

export type Brand = z.infer<typeof brandSchema>;
