import type { LoginTestimonial, LoginTestimonialInput } from "api-server-api";

export type TestimonialFields = Required<LoginTestimonialInput>;

export function toFields(t: LoginTestimonial): TestimonialFields {
  return { name: t.name, role: t.role, quote: t.quote, photoId: t.photoId };
}

export function moved<T>(list: readonly T[], from: number, by: -1 | 1): T[] {
  const to = from + by;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function photoSrc(photoId: string): string {
  return `/api/public/avatars/${photoId}`;
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? words[words.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}
