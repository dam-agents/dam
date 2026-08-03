---
name: dam-invoke
description: Spawn ephemeral DAM agents (Invocations) and get back a schema-validated result. Use when asked to spawn an ephemeral/throwaway agent, fan work out to a fresh agent, or run a make/test/eval step in isolation and expect a typed result (a number, a verdict, an object). Provides a small node SDK (spawn / listImages / listConnections).
allowed-tools: Bash(node *), Write
---

# DAM invoke

The platform can spawn an **ephemeral agent** (an *Invocation*): a fresh agent
that runs one prompt to completion, reports one result, and is then reaped. You
(the driver) create it, hand it a prompt plus the result shape you expect, and
get the validated result back. It starts empty, runs unattended, and cannot ask
you anything.

Use this to fan work out to fresh agents: a "make" step that produces something,
a "test" or "eval" step that judges it, or any task you want run in isolation
with a typed answer.

## The SDK

A dependency-free node module ships in the image at:

```
/usr/local/lib/driver-sdk.mjs
```

It self-configures from the pod environment (no URL or token to pass). Write a
small `.mjs` script that imports it and run it with `node`.

```js
import { spawn, listImages, listConnections, s } from "/usr/local/lib/driver-sdk.mjs";
```

## Before you spawn: choose the image and connections — do not guess

What the Invocation can do depends entirely on which image it runs and which
connections it gets. Never just take `listImages()[0]`. Instead:

1. Run `listImages()` and `listConnections()` and show the human what is
   available. If it is not obvious which to use, **ask them** which image and
   which connections it should get.
2. **Image:** an Invocation that has to reason (compute, write code, judge) needs
   an **LLM-capable** harness such as `claude-code`. A non-LLM image (for example
   a plain shell image) has no model and cannot even start a session — its
   trigger fails immediately with an auth error and it just hangs until its
   deadline.
3. **Connections:** any Invocation that runs a model needs a **model connection**
   in `connections`, or it fails to start. Add whatever else the task needs (a
   repo, an API). Everything you pass must be a subset of your own grants.

## Quickstart: an Invocation that returns a single integer

Discover what is available, confirm the image and a model connection with the
human, then spawn:

```js
// spawn-demo.mjs
import { spawn, listImages, listConnections } from "/usr/local/lib/driver-sdk.mjs";

const images = await listImages();
const conns = await listConnections();
console.log("images:", images.map((i) => i.id).join(", "));
console.log("connections:", conns.map((c) => `${c.name} (${c.id})`).join(", "));

// Pick an LLM image and a model connection — confirm these with the human rather
// than guessing. The find() calls are a starting hint, not a guarantee.
const image = images.find((i) => /claude|codex|gpt|gemini/i.test(i.id)) ?? images[0];
const model = conns.find((c) => /model|anthropic|openai|gemini|key/i.test(c.name));
if (!model) throw new Error("no model connection granted — ask the human to grant one to this agent");

const answer = await spawn({
  template: image.id,
  connections: [model.id],
  prompt: "Compute 6 * 7 and report the result as a single integer.",
  schema: "integer", // it must return one integer
});

console.log("returned:", answer); // 42
```

Run it:

```bash
node ~/spawn-demo.mjs
```

`spawn()` blocks until the Invocation reports a result that passes validation,
then resolves with that result. Progress lines (`[invoke] spawned ... -> agent-xxx`,
`[invoke] done ...`) print to stderr so you can watch it run.

## `spawn(opts)`

| option | meaning |
|---|---|
| `template` | Template id from `listImages()`. **Preferred.** |
| `image` | Full image ref (advanced). A bare name fails to pull — use `template`. |
| `prompt` | What the Invocation should do (required). |
| `schema` | Result shape it must return (required). Shorthand or raw JSON Schema. |
| `connections` | Connection ids to grant it. Must be a subset of `listConnections()`. Default none. |
| `label` | Log label. Defaults to the template/image. |
| `memory` | Memory limit, e.g. `"4Gi"`. Raise it for a heavy node. See below. |
| `cpu` | CPU limit, e.g. `"2"` or `"500m"`. Inherits the template when omitted. |
| `ttlMs` | Server-side liveness deadline for this node. Default ~60 min, bounded ~1 min..6 h. See below. |
| `pollMs` | Poll interval, default 5000. |
| `timeoutMs` | Client backstop. Defaults to just past `ttlMs` so the server fails first. |

Returns the validated result. Throws `InvocationFailed` if it fails (silent exit
past its deadline, or an internal error). Let it throw to abort, or wrap in
`try/catch` to retry.

**Give a heavy node more `memory`.** The template's default (often 1Gi) is fine
for a quick compute or a gate, but a Make that clones a repo and runs an install
or build will OOM-kill at 1Gi and be reaped. Pass `memory: "4Gi"` (or more) for
those. An OOM-killed node is failed fast by the platform, not left to idle, so if
a node keeps dying, raise its memory.

**Pick `ttlMs` per node — it is your fast-fail lever.** A node that should reply
quickly (a gate, a small compute) should get a short `ttlMs` (say `10 * 60_000`),
so a misconfigured or wedged one fails in minutes instead of hanging to the
default hour. A heavy node (clone + build + a large change) should get a longer
`ttlMs` so it is not guillotined mid-work. If a node keeps hitting the deadline,
it is either under-resourced on time or wedged (often waiting on tooling its image
or egress can't provide) — shorten the task, not just the timeout.

## Schema shorthand (`s`)

The server validates the result against JSON Schema. `s()` expands a tiny
shorthand so the intent stays readable; you can also pass raw JSON Schema and it
is used as-is.

```js
"integer"                              // a single integer (also: string, number, boolean, null)
{ pass: "boolean", note: "string" }    // object, both fields required, no extras allowed
{ score: "number?" }                   // trailing "?" makes a field optional
["string"]                             // array of strings
{ verdict: s.enum(["passed", "continue"]), score: "number?" } // enum field
```

`spawn({ schema })` runs this for you; call `s(...)` directly only if you want to
inspect the JSON Schema it produces.

## Discovery

- `listImages()` -> `[{ id, name, image, description }]`. Use `id` as `template`.
- `listConnections()` -> `[{ id, name, hosts }]`. The Invocation may carry any
  subset of these and nothing more (**attenuation**). Requesting a connection you
  don't hold returns 403. If it needs a connection you lack, ask the human to
  grant it to this agent first.

## Things to know

- **An Invocation is unattended.** No human answers it, so its prompt must let it
  make its own calls and run end to end. It reports via a `report_result` tool
  that the platform injects — you don't wire that up, and it's told how in its
  prompt.
- **Validation is structural, not truth.** The platform checks the result has the
  right shape, never that it's correct. Judging correctness is your prompt's job.
- **No resumability.** If this agent's turn crashes mid-run, any in-memory state
  (a variable you were threading across spawns) is lost. Results already returned
  are gone with it unless your prompt pushed durable output to a connection (e.g.
  a git ref). Design long runs so a rerun is cheap.
- **Attenuation is real security.** An Invocation can never exceed the connections
  you grant it, and never exceed your own grants.
