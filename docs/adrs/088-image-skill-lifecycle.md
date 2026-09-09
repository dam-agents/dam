---
id: 088
title: Image-shipped skills are platform-managed while untouched
status: accepted
subsystem: agent-skills
tags: [skills, skill-origin, image]
summary: The image carries hashes of every skill version it ever shipped; local copies matching that history are seeded, updated, and removed with the image, and a diverged copy becomes the user's.
---

# ADR-088: Image-shipped skills are platform-managed while untouched

**Date:** 2026-09-08
**Status:** Accepted
**Owner:** @jjeliga

## Context

Image skills are copied to the agent volume at first boot and never touched again ([persistence](../architecture/persistence.md): user edits must survive image upgrades). Skill origin - image-shipped or user-created - is decided by comparing against the current image on every read; nothing is stored. After any image change this goes wrong in every direction: a removed skill stays behind and reads as user-created - miscredited and publishable; an added skill never reaches existing agents; an updated skill stays frozen at its seeded version.

## Decision

Image-shipped skills are managed per skill, not per volume, under one rule: **a local copy whose content matches any version the image ever shipped is the platform's - seeded, updated, and deleted with the image; the moment it diverges it is the user's - kept, judged user-authored, unmarked.**

- The image carries a shipped-skills manifest: per skill name, the content hash of every version ever shipped - append-only, a few bytes per version, generated and verified at image build.
- Reconciliation runs when the pod applies a runtime-channel snapshot (the first moment it knows the installed set): a manifest-matching local skill is overwritten when the image ships a newer version, deleted when the name is no longer shipped. Installed Skill Refs are exempt - their source governs them.
- Additions seed once per volume through a per-skill ledger: never overwrites, a name already present counts as seeded. Safe on the agent-writable volume, since it only suppresses copies of image content. The first-boot workspace seed stays for everything that isn't a skill.
- Origin classification and the publish gate are unchanged - no contract or UI changes. An edited copy of a shipped skill still reads system-modified and can't publish; an edited copy of a dropped skill reads user-created.
- Hashes of skills dropped before this decision are backfilled, so existing agents heal on their next snapshot.

## Alternatives Considered

- **Record what the image seeded in a marker file on the agent volume** - tried while origin classification was built and reverted: the agent can rewrite its own volume, third-party images ship skills we can't stamp, and agents created before the marker never get one.
- **Re-run the whole workspace seed every boot** - propagates additions, but resurrects every file the user deliberately deleted, anywhere in $HOME.
- **Track removals as a list of retired names and delete on name match** - also deletes copies the user edited, and keeps deleting any new skill that reuses a retired name.
- **Keep dropped skills' copies on disk, marked "left over from an older image"** - needs a new origin value in the shared contract, version-skew handling, a UI group, and a publish-gate extension; and it labels the user's own edits as platform residue.
- **Store each skill's origin in Postgres when first seen** - a stored verdict goes stale, dies with the agent, and for existing agents would capture today's already-wrong judgments.

## Consequences

- **Easier:** all three drifts end. An untouched copy of a dropped skill disappears from existing agents - today it survives forever, relabeled user-created and publishable. A new skill reaches existing agents - today it provably never does. An updated skill follows the image instead of freezing as system-modified.
- **Harder:** the manifest is a new build artifact CI must verify - a skill changed or removed without appending to it reproduces the bug silently. The hash algorithm becomes a compatibility contract: changing it orphans the history, silently ending management (copies degrade to user-owned; no data loss). Two seed mechanisms coexist: per-skill ledger for skills, first-boot sentinel for the rest.
- **Committed-to:** append-only manifest with permanent hashes; the reconciler touches only byte-matched copies, never name matches; divergence irreversibly hands a copy to the user - so an edited copy of a dropped skill stays behind, unmarked; reconciliation on snapshot apply with the Installed-Skill-Ref exemption.
