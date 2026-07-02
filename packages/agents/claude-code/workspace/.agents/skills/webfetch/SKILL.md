---
name: webfetch
description: Replacement for the built-in WebFetch tool on backends where it is unavailable (this platform's non-Anthropic backends). Fetches a URL and extracts its main content as markdown. Use it when WebFetch is denied and the harness tells you to use this skill, or when you otherwise need to fetch a page.
allowed-tools: Bash(node *)
---

# WebFetch

On this platform's non-Anthropic model backends the built-in `WebFetch` tool
doesn't work (it relies on an Anthropic server-side capability), so the harness
denies it and directs you here. This skill fetches the page locally and
extracts the readable content as markdown. (On genuine Anthropic backends the
built-in works and this skill is unnecessary.)

## Usage

Pipe a JSON request to the fetch script on stdin:

```bash
echo '{"url":"URL","prompt":"QUESTION"}' | node /opt/cc-websearch/webfetch.cjs
```

The request accepts:

- `url` (string, required, must be a valid URL) — the page to fetch
- `prompt` (string, required) — the question to answer about the page

The script writes the extracted page content to stdout; errors and diagnostics
go to stderr. HTTP URLs are upgraded to HTTPS. Cross-host redirects are
reported but not followed. Only HTML content types are supported.

Fetching an arbitrary host may require a one-time egress approval for that host
before it succeeds. Use the returned content to answer the user's question.
