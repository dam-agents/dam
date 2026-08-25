export function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export class TinySearch {
  #docs = [];

  add(id, text) {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("id must be a non-empty string");
    }
    if (typeof text !== "string") {
      throw new TypeError("text must be a string");
    }
    this.remove(id);
    this.#docs.push({ id, text });
  }

  remove(id) {
    const index = this.#docs.findIndex((doc) => doc.id === id);
    if (index === -1) return false;
    this.#docs.splice(index, 1);
    return true;
  }

  get size() {
    return this.#docs.length;
  }

  search(query, { limit = 10 } = {}) {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const hits = [];
    for (const doc of this.#docs) {
      const tokens = tokenize(doc.text);
      let score = 0;
      let matchesAll = true;
      for (const term of terms) {
        let count = 0;
        for (const token of tokens) {
          if (token === term) count += 1;
        }
        if (count === 0) {
          matchesAll = false;
          break;
        }
        score += count;
      }
      if (matchesAll) hits.push({ id: doc.id, score });
    }

    hits.sort(
      (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return hits.slice(0, limit);
  }
}
