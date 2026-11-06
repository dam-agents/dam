import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useSaveLoginTestimonials() {
  return useMutation({
    ...trpc.loginTestimonials.save.mutationOptions(),
    meta: {
      invalidates: [trpc.loginTestimonials.list.queryKey()],
      errorToast: "Couldn't save the login page's testimonials",
    },
  });
}
