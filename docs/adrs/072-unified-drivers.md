# ADR-072: Unified `drivers:` manifest with pluggable events and default-on built-ins

**Date:** 2026-06-30
**Status:** Accepted
**Owner:** @jezekra1

## Context

The agent runtime has two parallel ways to handle manifest-bound behavior. Contribution kinds are resolved through a plugin registry keyed by the manifest's `drivers:` map, so a harness can rebind a kind to an extension-supplied impl — an open, overridable extension point. Event kinds are dispatched by a hardcoded switch over a fixed built-in set, with no registry lookup, manifest selection, or extension hook — a closed set an external implementor cannot override or extend. This PR adds harness-config as yet a third shape: a special top-level manifest block wired ad hoc. Separately, every harness manifest re-declares the same built-in contribution drivers — pi-agent duplicates platform-base's four entries verbatim under a comment to keep them "in sync … until the manifest schema supports inheritance." Folding the still-unmerged harness-config block into a unified, default-driven `drivers:` map fixes all three before any of it ships — while older deployed manifests, which predate this PR, must keep working untouched.

## Decision

Unify the runtime-manifest around one `drivers:` map: every kind — contribution or event — is a driver entry the runtime resolves uniformly through the plugin registry, so event handlers become externally overridable and extensible exactly like contribution handlers are today. The decision's rules:

- **One registry, both families.** Contribution kinds and event kinds are both resolved by registry lookup from their `drivers:` entry. The event path stops being a hardcoded built-in switch.
- **Built-ins are on by default.** Every built-in kind is registered with a default binding. A manifest entry is required only to supply per-harness configuration, override the impl, or opt a built-in out. Omitting a built-in keeps it active with its default.
- **`impl` defaults to the kind's built-in impl.** An entry names `impl` only to override. The default is identity (impl name equals kind) for every built-in but one, whose historical kind→impl mapping is preserved as its default so older manifests that name that impl explicitly still resolve.
- **Capabilities are derived.** The kinds an agent advertises are the built-in defaults, plus kinds the manifest declares, minus kinds it opts out — no longer a literal read of the declared keys.
- **harness-config is an ordinary driver entry from the outset**, not a top-level block — it is new in this PR, so it is defined in the unified shape directly rather than migrated through a compatibility layer. A driver may carry capabilities beyond a single handler (harness-config also presents a catalog and answers a current-config read); only kinds that need them declare them.
- **Older manifests keep working untouched.** Existing deployed manifests declare every built-in contribution kind explicitly and predate event and harness-config entries. They keep parsing and behaving identically: an explicit `impl:` is honored (including the one built-in whose impl name differs from its kind), and kinds absent from the map — every event kind, for an old manifest — fall back to their built-in defaults. No manifest version bump.

Out of scope: the harnesses' read/apply/discovery behavior, the api-server, and the UI are unchanged — this is a dispatch-and-manifest unification, not a behavior change.

## Alternatives Considered

- **Cosmetic manifest-only unification** (move `harnessConfig` under `drivers:` but keep events hardcoded) — the manifest would imply event drivers are pluggable while the runtime ignores them; trades one inconsistency for a misleading one.
- **Extend the plugin contract with dedicated present/read methods** for harness-config's non-event capabilities — bloats the shared contract for a single consumer; rejected for a driver that carries extra capabilities only it reads.
- **Leave the two dispatch systems as-is** — keeps the closed event set simple, but the event path stays non-overridable and the per-harness driver boilerplate stays duplicated (the documented sync wart).

## Consequences

- **Easier:** External implementors and harness authors can override or add an event handler by the same rebinding they already use for contribution kinds — today impossible, because the event path is a switch with no registry lookup.
- **Easier:** Harness manifests stop repeating built-in driver boilerplate; pi-agent's manifest drops from four inherited driver entries kept in manual sync with platform-base (per its own comment) to only its harness-config configuration.
- **Harder:** Event handlers lose compile-time per-kind payload typing — the current switch narrows each kind to its exact payload, whereas a registry-resolved handler receives its kind's payload to narrow itself, matching how contribution handlers already take a union.
- **Harder:** The capability set an agent advertises is no longer visible by reading its manifest alone; it is derived (defaults ∪ declared ∖ opted-out), so reasoning about what an agent supports requires knowing the default table.
- **Committed-to:** A single driver contract spanning contribution and event kinds, plus a runtime-owned default-binding table for every built-in kind — adding or removing a built-in kind becomes a runtime code change rather than a manifest edit.
