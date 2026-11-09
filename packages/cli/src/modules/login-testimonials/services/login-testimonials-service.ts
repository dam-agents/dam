import type {
  LoginTestimonial,
  LoginTestimonialsSaveInput,
} from "api-server-api";
import type { Result } from "../../../result.js";
import type { TokenProvider } from "../../auth/index.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

type ServiceResult<T> = Promise<Result<T, TransportError | AuthRequiredError>>;

export interface LoginTestimonialsService {
  list(): ServiceResult<LoginTestimonial[]>;
  save(input: LoginTestimonialsSaveInput): ServiceResult<LoginTestimonial[]>;
  uploadPhoto(png: Blob): Promise<string>;
  downloadPhoto(photoId: string): Promise<Uint8Array>;
}

// UNIT_BOUNDARY_DESCRIPTION: the CLI's hold on the login page's testimonials: the operator-only list and save over tRPC, and their photos over plain HTTP, uploaded through the avatar upload and read back from its public URL. A photo call that fails throws with the server's own message.
export function createLoginTestimonialsService(deps: {
  host: string;
  trpc: TrpcClient;
  tokenProvider: TokenProvider;
}): LoginTestimonialsService {
  return {
    list: () => trpcCall(() => deps.trpc.loginTestimonials.list.query()),
    save: (input) =>
      trpcCall(() => deps.trpc.loginTestimonials.save.mutate(input)),
    async uploadPhoto(image) {
      const token = await deps.tokenProvider.getValidAccessToken(deps.host);
      if (!token.ok) throw new Error(`not logged in to ${deps.host}`);
      const res = await fetch(`${deps.host}/api/avatars`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.value}`,
          "Content-Type": image.type,
        },
        body: image,
      });
      const body = (await res.json().catch(() => ({}))) as {
        avatar?: string;
        error?: string;
      };
      if (!res.ok || !body.avatar?.startsWith("image:"))
        throw new Error(body.error ?? `HTTP ${res.status}`);
      return body.avatar.slice("image:".length);
    },
    async downloadPhoto(photoId) {
      const res = await fetch(`${deps.host}/api/public/avatars/${photoId}`);
      if (!res.ok) throw new Error(`photo ${photoId}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
