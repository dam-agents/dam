function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function readPersistedFlag(key: string, fallback: boolean): boolean {
  const raw = readRaw(key);
  return raw === null ? fallback : raw === "1";
}

export function writePersistedFlag(key: string, value: boolean): void {
  writeRaw(key, value ? "1" : "0");
}

export function readPersistedNumber<T extends number | null>(
  key: string,
  fallback: T,
): number | T {
  const raw = readRaw(key);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function writePersistedNumber(key: string, value: number): void {
  writeRaw(key, String(value));
}
