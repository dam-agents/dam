import { TRPCError } from "@trpc/server";
import type { LoginTestimonialsService } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { firstMissingPhoto } from "../domain/testimonials.js";
import type { TestimonialsRepository } from "../infrastructure/testimonials-repository.js";

export type LoginTestimonialsForOperator = (
  operatorSub: string,
) => LoginTestimonialsService;

// UNIT_BOUNDARY_DESCRIPTION: an operator's list and save of the login testimonials. A save checks that every photo it names is stored before it replaces the list, and logs who saved how many.
export function createLoginTestimonialsAdmin(deps: {
  repo: TestimonialsRepository;
}): LoginTestimonialsForOperator {
  return (operatorSub) => ({
    list: () => deps.repo.list(),
    async save({ testimonials }) {
      const photoIds = testimonials.map((t) => t.photoId);
      const stored = await deps.repo.storedPhotos(
        photoIds.filter((id): id is string => id !== null),
      );
      const missing = firstMissingPhoto(photoIds, stored);
      if (missing !== null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `photo ${missing} is not an uploaded image; upload it again`,
        });
      }
      await deps.repo.replace(testimonials, operatorSub);
      getLogger().info(
        { operator: operatorSub, count: testimonials.length },
        "login_testimonials.saved",
      );
      return deps.repo.list();
    },
  });
}

// UNIT_BOUNDARY_DESCRIPTION: what the login page reads, with no sign-in: the testimonials in order, each photo as the public URL of its avatar image.
export function createPublicTestimonials(deps: {
  repo: TestimonialsRepository;
  photoUrl: (photoId: string) => string;
}) {
  return async () =>
    (await deps.repo.list()).map((t) => ({
      name: t.name,
      role: t.role,
      quote: t.quote,
      photoUrl: t.photoId === null ? null : deps.photoUrl(t.photoId),
    }));
}

export type PublicTestimonials = ReturnType<typeof createPublicTestimonials>;
