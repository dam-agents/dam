---
name: query
description: Answer a question from the wiki, with citations. The primary consumption path (Slack and Web UI). Consults index.md and the relevant pages, synthesises a grounded answer, and cites every load-bearing claim back to its source. Use whenever the user asks a question about a documented source.
---

# query

1. Consult `index.md`, then read the relevant pages (entities/concepts/sources).
2. Synthesise an answer grounded in those pages. Cite every load-bearing claim
   back to the page and its source (`file:line @sha`).
3. Freshness: if a cited page's pinned commit lags source HEAD, answer anyway and
   add a freshness caveat. Do not re-verify on the hot path — `lint` owns refresh.
4. Rare miss: if the wiki cannot answer, read the source directly, answer, and
   file a new page so the next query hits the wiki. This is the exception.

Discipline: no fabricated citations. If unknown, say so and note the gap for
`lint`. Respond only when asked.
