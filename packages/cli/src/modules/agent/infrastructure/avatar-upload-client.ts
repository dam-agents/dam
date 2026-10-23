import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export type AvatarUploadOutcome =
  | { kind: "ok"; avatar: string }
  | { kind: "unreadable"; reason: string }
  | { kind: "failed"; status: number; reason: string };

export interface AvatarUploader {
  upload(path: string): Promise<AvatarUploadOutcome>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: an avatar image goes up the way the web app's
 * picker sends it: the file's bytes as the body of `POST /api/avatars`, with
 * the same bearer token the tRPC client uses. The server owns every rule
 * about the image — JPG or PNG, at most 2 MB, cropped to a square — and its
 * answer is the avatar value to put on the agent.
 */
export function createAvatarUploader(deps: {
  host: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}): AvatarUploader {
  const doFetch = deps.fetch ?? globalThis.fetch;
  return {
    async upload(path) {
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch (e) {
        return { kind: "unreadable", reason: (e as Error).message };
      }
      const token = await deps.getToken();
      if (token === null)
        return { kind: "failed", status: 401, reason: "not logged in" };
      let res: Response;
      try {
        res = await doFetch(new URL("/api/avatars", deps.host).toString(), {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type":
              CONTENT_TYPES[extname(path).toLowerCase()] ??
              "application/octet-stream",
          },
          body: new Uint8Array(bytes),
        });
      } catch (e) {
        return {
          kind: "failed",
          status: 0,
          reason: `cannot reach server \`${deps.host}\`: ${(e as Error).message}`,
        };
      }
      const body = (await res.json().catch(() => ({}))) as {
        avatar?: unknown;
        error?: unknown;
      };
      if (res.ok && typeof body.avatar === "string")
        return { kind: "ok", avatar: body.avatar };
      return {
        kind: "failed",
        status: res.status,
        reason:
          typeof body.error === "string"
            ? body.error
            : `the server answered HTTP ${res.status}`,
      };
    },
  };
}
