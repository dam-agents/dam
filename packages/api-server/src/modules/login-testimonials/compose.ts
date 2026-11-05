import type { Db } from "db";
import { createTestimonialsRepository } from "./infrastructure/testimonials-repository.js";
import {
  createLoginTestimonialsAdmin,
  createPublicTestimonials,
} from "./services/testimonials-service.js";

export function composeLoginTestimonialsModule(deps: {
  db: Db;
  photoUrl: (photoId: string) => string;
}) {
  const repo = createTestimonialsRepository(deps.db);
  return {
    forOperator: createLoginTestimonialsAdmin({ repo }),
    readPublic: createPublicTestimonials({ repo, photoUrl: deps.photoUrl }),
    photoIds: async () =>
      (await repo.list()).flatMap((t) => (t.photoId ? [t.photoId] : [])),
  };
}
