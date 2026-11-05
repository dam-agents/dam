import { operatorProcedure } from "../../auth-procedures.js";
import { t } from "../../trpc.js";
import { loginTestimonialsSaveInputSchema } from "./schemas.js";

export const loginTestimonialsRouter = t.router({
  list: operatorProcedure.query(({ ctx }) => ctx.loginTestimonials.list()),

  save: operatorProcedure
    .input(loginTestimonialsSaveInputSchema)
    .mutation(({ ctx, input }) => ctx.loginTestimonials.save(input)),
});
