---
name: websearch
description: Replacement for the built-in WebSearch tool on backends where it is unavailable (this platform's non-Anthropic backends). Searches the web via DuckDuckGo. Use it when WebSearch is denied and the harness tells you to use this skill, or when you otherwise need web search results.
allowed-tools: Bash(node *)
---

# WebSearch

On this platform's non-Anthropic model backends the built-in `WebSearch` tool
doesn't work (it relies on an Anthropic server-side capability), so the harness
denies it and directs you here. This skill queries DuckDuckGo locally and
returns the same shape of results. (On genuine Anthropic backends the built-in
works and this skill is unnecessary.)

## Usage

Pipe a JSON request to the search script on stdin:

```bash
echo '{"query":"SEARCH TERMS"}' | node /opt/cc-websearch/websearch.cjs
```

The request accepts:

- `query` (string, required, minimum 2 characters) — the search query
- `allowed_domains` (string[], optional) — only return results from these domains
- `blocked_domains` (string[], optional) — exclude results from these domains

The script writes `<search_results>` XML (title, URL, and snippet per result)
to stdout. Errors and diagnostics go to stderr.

Always use the results to inform your response, and cite source URLs when you
draw on them.
