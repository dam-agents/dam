---
id: 103
title: A Skill Source is a repository and a path
status: accepted
subsystem: skills
tags: [skills, egress]
summary: A Skill Source is identified by its repository and its path together, so one owner may register the same repository once per path; an installed skill keeps the path of the source it came from.
---

# ADR-103: A Skill Source is a repository and a path

**Date:** 2026-10-15 **Status:** Accepted **Owner:** @xjacka

## Context

A Skill Source is identified by its git URL alone ([ADR-030](030-skills-marketplace.md)): one owner may register a repository once, with at most one path.
An agent whose egress may read only one directory of a repository installs from it only through a source whose path is that directory (the directory fetch keys its egress check on the source path).
A black-box QA agent needs exactly that for its test profile under `qa/` of the product repository, while the same owner already has the product repository registered — without a path, or with the path of its developer skills.
The second registration is refused, so the profile cannot be installed without breaking the first source.

## Decision

A Skill Source is identified by its repository and its path together: one owner may register the same repository several times, once per path, and each registration lists, scans and is deleted on its own.
An installed skill records the path of the source it was installed from, and that recorded path — not a lookup by repository — drives its scan, its fetch and its egress check.

The identity of an installed skill on an agent stays the agent, the repository and the skill name.
An agent therefore holds a skill name from one path of a repository at a time; installing the same name from another path of that repository replaces it.

A path is compared in its canonical form, and "no path" is a value of its own, so the repository without a path and the repository with a path are two sources.
Shadowing follows the same identity: a user source shadows a system or template source only when both the repository and the path match.

## Alternatives Considered

- **Several paths on one source** — keeps the repository identity, but every scan, install and delete has to say which of the source's paths it means, so the path becomes part of the identity anyway, one level down.
- **Fetch by each skill's own directory** — narrows the egress check further, but a source without a path scans only the standard source roots, so a profile under `qa/` is never listed to install.
- **Keep one source per repository and move the profile under a standard source root** — every agent and every developer session that reads the product repository's skills would then load the QA profile.

## Consequences

- **Easier:** the QA agent's profile installs from a second registration of the product repository with path `qa`, next to the existing one, which is the case that was refused.
- **Easier:** egress for a path source stays one directory, because the fetch keeps keying on the recorded path rather than on whichever source of the repository a lookup finds first.
- **Harder:** two sources of one repository can both carry a skill of the same name; an agent can hold only one of them, and the second install silently replaces the first.
- **Harder:** every read that resolved a source from a repository alone (listing dedupe, install, batch apply, skill sets, the scan cache, the CLI's source reference) now needs the path as well; an existing installed skill whose row has no path keeps meaning the repository's path-less source.
- **Committed-to:** the uniqueness of user sources is per owner, repository and path, enforced in the database.
