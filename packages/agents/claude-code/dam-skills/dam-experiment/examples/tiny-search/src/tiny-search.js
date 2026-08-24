/**
 * TinySearch — a minimal in-memory full-text search index for Node.
 *
 * Deliberately naive: documents are stored as raw text, and every call to
 * search() re-tokenizes every document from scratch and scans the full token
 * list once per query term. There is no index of any kind. The slowness is
 * the exercise — do not "fix" this file outside an optimization campaign.
 *
 * Behavioral contract (pinned by the test suite):
 * - tokenize(): lowercase, split on any run of non-alphanumeric characters.
 * - search() uses AND semantics: a document matches only if it contains
 *   every query term at least once.
 * - score = total number of occurrences of all query terms in the document.
 * - Results are ordered by score descending, ties broken by id ascending
 *   (plain string comparison), capped at `limit` (default 10).
 * - add() with an existing id replaces that document.
 */

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
