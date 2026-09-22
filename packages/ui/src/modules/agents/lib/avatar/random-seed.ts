const SEED_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SEED_LENGTH = 8;

export function randomAvatarSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SEED_LENGTH));
  return Array.from(bytes, (b) => SEED_ALPHABET[b % SEED_ALPHABET.length]).join(
    "",
  );
}

export function randomAvatarSeeds(count: number): string[] {
  return Array.from({ length: count }, randomAvatarSeed);
}
