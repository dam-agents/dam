export class TinyCache {
  #entries = [];
  #sortedKeys = [];
  #maxEntries;
  #now;

  constructor({ maxEntries = Infinity, now = Date.now } = {}) {
    this.#maxEntries = maxEntries;
    this.#now = now;
  }

  set(key, value, { ttlMs = null } = {}) {
    this.#purgeExpired();
    const expiresAt = ttlMs === null ? null : this.#now() + ttlMs;
    const existing = this.#entries.find((e) => e.key === key);
    if (existing) {
      existing.value = value;
      existing.expiresAt = expiresAt;
    } else {
      if (this.#entries.length >= this.#maxEntries) this.#entries.shift();
      this.#entries.push({ key, value, expiresAt });
    }
    this.#sortedKeys = this.#entries.map((e) => e.key).sort();
    return this;
  }

  get(key) {
    this.#purgeExpired();
    const entry = this.#entries.find((e) => e.key === key);
    return entry ? entry.value : undefined;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    this.#purgeExpired();
    const i = this.#entries.findIndex((e) => e.key === key);
    if (i === -1) return false;
    this.#entries.splice(i, 1);
    this.#sortedKeys = this.#entries.map((e) => e.key).sort();
    return true;
  }

  keys() {
    this.#purgeExpired();
    return [...this.#sortedKeys];
  }

  get size() {
    this.#purgeExpired();
    return this.#entries.length;
  }

  #purgeExpired() {
    const now = this.#now();
    let purged = false;
    this.#entries = this.#entries.filter((e) => {
      const keep = e.expiresAt === null || e.expiresAt > now;
      if (!keep) purged = true;
      return keep;
    });
    if (purged) this.#sortedKeys = this.#entries.map((e) => e.key).sort();
  }
}

export default TinyCache;
