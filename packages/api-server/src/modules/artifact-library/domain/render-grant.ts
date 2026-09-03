export const RENDER_TOKEN_TTL_MS = 60 * 1000;

export interface RenderGrant {
  artifactId: string;
  version: number;
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

export function isRenderTokenShape(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}

export function grantCovers(
  grant: RenderGrant,
  artifactId: string,
  version: number,
): boolean {
  return grant.artifactId === artifactId && grant.version === version;
}
