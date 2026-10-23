import { isNonNullObject } from "api-server-api";

export function platformOf(frame: unknown): Record<string, unknown> | null {
  if (!isNonNullObject(frame)) return null;
  const params = frame.params;
  if (!isNonNullObject(params)) return null;
  const meta = params._meta;
  if (!isNonNullObject(meta)) return null;
  return isNonNullObject(meta.platform) ? meta.platform : null;
}

export function withPlatform<T>(
  frame: T,
  update: (platform: Record<string, unknown>) => Record<string, unknown> | null,
): T {
  if (!isNonNullObject(frame)) return frame;
  const params = isNonNullObject(frame.params) ? frame.params : {};
  const meta = isNonNullObject(params._meta) ? params._meta : {};
  const platform = isNonNullObject(meta.platform) ? meta.platform : {};
  const next = update(platform);
  const nextMeta: Record<string, unknown> = { ...meta };
  if (next === null) delete nextMeta.platform;
  else nextMeta.platform = next;
  const nextParams: Record<string, unknown> = { ...params };
  if (Object.keys(nextMeta).length > 0) nextParams._meta = nextMeta;
  else delete nextParams._meta;
  return { ...frame, params: nextParams } as T;
}
