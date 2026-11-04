import type { LoginTestimonial, LoginTestimonialInput } from "api-server-api";

export type DraftTestimonial = Required<LoginTestimonialInput> & {
  key: string;
};

let nextKey = 0;

export function toDraft(
  t: Pick<LoginTestimonial, "name" | "role" | "quote" | "photoId">,
): DraftTestimonial {
  nextKey += 1;
  return {
    key: `t${nextKey}`,
    name: t.name,
    role: t.role,
    quote: t.quote,
    photoId: t.photoId,
  };
}

export function toSaveInput(draft: readonly DraftTestimonial[]) {
  return draft.map(({ name, role, quote, photoId }) => ({
    name,
    role,
    quote,
    photoId,
  }));
}

export function sameTestimonials(
  draft: readonly DraftTestimonial[],
  saved: readonly LoginTestimonial[],
): boolean {
  return (
    draft.length === saved.length &&
    draft.every(
      (t, i) =>
        t.name === saved[i]!.name &&
        t.role === saved[i]!.role &&
        t.quote === saved[i]!.quote &&
        t.photoId === saved[i]!.photoId,
    )
  );
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
