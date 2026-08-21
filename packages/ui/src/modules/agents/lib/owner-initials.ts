export function ownerInitials(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const words = localPart.split(/[._\-+]+/).filter(Boolean);
  const first = [...(words[0] ?? "")][0] ?? "";
  const last =
    words.length > 1 ? ([...(words[words.length - 1] ?? "")][0] ?? "") : "";
  return (first + last).toUpperCase();
}
