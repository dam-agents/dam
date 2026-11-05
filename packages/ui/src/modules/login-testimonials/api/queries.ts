import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useLoginTestimonials() {
  return useQuery({
    ...trpc.loginTestimonials.list.queryOptions(),
    meta: { errorToast: "Couldn't load the login page's testimonials" },
  });
}
