---
name: query
description: Answer a question from the wiki, with citations. The primary consumption path (Slack and Web UI). Consults wiki/index.md and the relevant pages, synthesises a grounded answer, and cites every load-bearing claim back to its source. Read-only by default; only a genuine miss writes a page. Use whenever the user asks a question about a documented source.
---

# query

The path that answers a question from the wiki. Read-only by default — only the
rare miss writes.

1. **Locate.** Read `wiki/index.md`, then open only the pages it points to that
   bear on the question (sources / entities / concepts). Follow wikilinks as
   needed, but stay targeted — do not read the whole wiki.
2. **Answer.** Synthesise from those pages. Cite every load-bearing claim back to
   its source as `file:line @sha`, reusing the citation each page already carries.
   Never fabricate a citation; if the wiki does not say it, do not assert it.
3. **Freshness, without re-verifying.** Answer from the wiki as written, even when
   a page may lag source HEAD. Do not clone or read the source to check — `lint`
   owns refresh, not the hot path. If a page is plainly behind (its `updated:`
   predates activity the question is about), say the answer reflects the wiki as
   of that page's pinned commit.
4. **Rare miss.** Only when the wiki genuinely cannot answer: fetch the source
   (`scripts/fetch-source.sh <repo> [ref]`) so you have a real `@sha`, read what
   you need, answer, then file a new page with full provenance following the
   `ingest` discipline (frontmatter, citations, a `wiki/index.md` line, a
   `wiki/log.md` entry) and commit + push the `wiki/` repo. This is the exception
   that turns the next identical question into a wiki hit.

A read-only answer touches nothing — no commit, no log entry. Only a miss that
creates a page writes. Note any genuine gap for `lint`. Respond only in the
channel that asked.
