import type { Context } from "hono";

import type { ArtifactRow } from "../infrastructure/artifact-library-repository.js";
import type { SharedResolution } from "../services/share-viewer-service.js";

export type Authorized =
  | { ok: true; artifact: ArtifactRow }
  | { ok: false; response: Response };

export type Authorize = (
  c: Context,
  resolution: SharedResolution,
) => Promise<Authorized>;

export const PRIVATE_NO_STORE = "private, no-store";

export function allowed(artifact: ArtifactRow): Authorized {
  return { ok: true, artifact };
}

export function denied(response: Response): Authorized {
  return { ok: false, response };
}

export function isRestricted(artifact: ArtifactRow): boolean {
  return artifact.visibility === "restricted";
}
