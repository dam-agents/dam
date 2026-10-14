import type { Db } from "db";
import { eq, publicImageUrls } from "db";

export interface PublicImageUrls {
  get(sha256: string): Promise<string | null>;
  put(sha256: string, url: string): Promise<void>;
}

export function createPublicImageUrlsRepository(db: Db): PublicImageUrls {
  return {
    async get(sha256) {
      const [row] = await db
        .select({ url: publicImageUrls.url })
        .from(publicImageUrls)
        .where(eq(publicImageUrls.sha256, sha256));
      return row?.url ?? null;
    },
    async put(sha256, url) {
      await db
        .insert(publicImageUrls)
        .values({ sha256, url })
        .onConflictDoNothing();
    },
  };
}
